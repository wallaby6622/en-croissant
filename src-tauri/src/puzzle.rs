use std::{collections::VecDeque, fs::remove_file, path::PathBuf, sync::Mutex};

use diesel::{dsl::sql, sql_types::Bool, Connection, ExpressionMethods, QueryDsl, RunQueryDsl};
use once_cell::sync::Lazy;
use serde::Serialize;
use specta::Type;

use crate::{
    db::{puzzle_themes, puzzles, themes, Puzzle},
    error::Error,
};

#[derive(Debug)]
struct PuzzleCache {
    cache: VecDeque<Puzzle>,
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
}

impl PuzzleCache {
    fn new() -> Self {
        Self {
            cache: VecDeque::new(),
            file: String::new(),
            min_rating: 0,
            max_rating: 0,
            theme: None,
        }
    }

    fn get_puzzles(
        &mut self,
        file: &str,
        min_rating: u16,
        max_rating: u16,
        theme: &Option<String>,
    ) -> Result<(), Error> {
        if self.cache.is_empty()
            || self.min_rating != min_rating
            || self.max_rating != max_rating
            || self.theme != *theme
            || self.file != file
        {
            self.cache.clear();

            let mut db = diesel::SqliteConnection::establish(file)?;

            let new_puzzles: Vec<Puzzle> = if let Some(theme_name) = theme {
                puzzles::table
                    .inner_join(puzzle_themes::table.inner_join(themes::table))
                    .filter(themes::name.eq(theme_name))
                    .filter(puzzles::rating.le(max_rating as i32))
                    .filter(puzzles::rating.ge(min_rating as i32))
                    .select(puzzles::all_columns)
                    .order(sql::<Bool>("RANDOM()"))
                    .limit(20)
                    .load::<Puzzle>(&mut db)?
            } else {
                puzzles::table
                    .filter(puzzles::rating.le(max_rating as i32))
                    .filter(puzzles::rating.ge(min_rating as i32))
                    .order(sql::<Bool>("RANDOM()"))
                    .limit(20)
                    .load::<Puzzle>(&mut db)?
            };

            self.cache = new_puzzles.into_iter().collect();
            self.file = file.to_owned();
            self.min_rating = min_rating;
            self.max_rating = max_rating;
            self.theme = theme.clone();
        }

        Ok(())
    }

    fn get_next_puzzle(&mut self) -> Option<Puzzle> {
        self.cache.pop_front()
    }
}

static PUZZLE_CACHE: Lazy<Mutex<PuzzleCache>> = Lazy::new(|| Mutex::new(PuzzleCache::new()));

#[tauri::command]
#[specta::specta]
pub fn get_puzzle(
    file: String,
    min_rating: u16,
    max_rating: u16,
    theme: Option<String>,
) -> Result<Puzzle, Error> {
    let mut cache = PUZZLE_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.get_puzzles(&file, min_rating, max_rating, &theme)?;
    cache.get_next_puzzle().ok_or(Error::NoPuzzles)
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleDatabaseInfo {
    title: String,
    description: String,
    puzzle_count: i32,
    storage_size: u64,
    path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_puzzle_db_info(file: PathBuf) -> Result<PuzzleDatabaseInfo, Error> {
    let path = file;

    let mut db = diesel::SqliteConnection::establish(&path.to_string_lossy())?;

    let puzzle_count = puzzles::table.count().get_result::<i64>(&mut db)? as i32;

    let storage_size = path.metadata()?.len();
    let filename = path.file_name().expect("get filename").to_string_lossy();

    Ok(PuzzleDatabaseInfo {
        title: filename.to_string(),
        description: "".to_string(),
        puzzle_count,
        storage_size,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_puzzle_database(file: String) -> Result<(), Error> {
    let mut cache = PUZZLE_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    remove_file(&file)?;
    if cache.file == file {
        *cache = PuzzleCache::new();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_puzzle_themes(file: String) -> Result<Vec<String>, Error> {
    let mut db = diesel::SqliteConnection::establish(&file)?;
    let result: Vec<String> = themes::table
        .select(themes::name)
        .order(themes::name.asc())
        .load(&mut db)?;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn get_themes_for_puzzle(file: String, puzzle_id: i32) -> Result<Vec<String>, Error> {
    let mut db = diesel::SqliteConnection::establish(&file)?;
    let result: Vec<String> = themes::table
        .inner_join(puzzle_themes::table)
        .filter(puzzle_themes::puzzle_id.eq(puzzle_id))
        .select(themes::name)
        .order(themes::name.asc())
        .load(&mut db)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use tempfile::NamedTempFile;

    fn database(id: i32, count: i32) -> NamedTempFile {
        let file = NamedTempFile::new().unwrap();
        let mut db = diesel::SqliteConnection::establish(file.path().to_str().unwrap()).unwrap();
        db.batch_execute("CREATE TABLE puzzles (id INTEGER PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL, rating INTEGER NOT NULL, rating_deviation INTEGER NOT NULL, popularity INTEGER NOT NULL, nb_plays INTEGER NOT NULL);
            CREATE TABLE themes (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE puzzle_themes (puzzle_id INTEGER NOT NULL, theme_id INTEGER NOT NULL);
            INSERT INTO themes VALUES (1, 'fork'), (2, 'pin');").unwrap();
        for offset in 0..count {
            db.batch_execute(&format!("INSERT INTO puzzles VALUES ({}, 'fen', 'moves', {}, 0, 0, 0); INSERT INTO puzzle_themes VALUES ({}, {});", id + offset, 1000 + offset * 100, id + offset, offset % 2 + 1)).unwrap();
        }
        file
    }

    fn next(cache: &mut PuzzleCache, file: &NamedTempFile) -> Option<Puzzle> {
        cache
            .get_puzzles(file.path().to_str().unwrap(), 0, 3000, &None)
            .unwrap();
        cache.get_next_puzzle()
    }

    #[test]
    fn switching_databases_discards_cached_puzzles() {
        let first = database(1, 3);
        let second = database(100, 1);
        let mut cache = PuzzleCache::new();
        assert!(next(&mut cache, &first).unwrap().id < 100);
        assert_eq!(next(&mut cache, &second).unwrap().id, 100);
    }

    #[test]
    fn short_batches_refill_after_the_last_puzzle() {
        for count in [1, 3, 19, 20, 21] {
            let file = database(1, count);
            let mut cache = PuzzleCache::new();
            for _ in 0..count * 2 + 1 {
                assert!(next(&mut cache, &file).is_some());
            }
        }
    }

    #[test]
    fn changing_filters_and_empty_results_can_recover() {
        let file = database(1, 3);
        let path = file.path().to_str().unwrap();
        let mut cache = PuzzleCache::new();
        cache.get_puzzles(path, 1000, 1000, &None).unwrap();
        assert_eq!(cache.get_next_puzzle().unwrap().rating, 1000);
        cache
            .get_puzzles(path, 0, 3000, &Some("pin".into()))
            .unwrap();
        assert_eq!(cache.get_next_puzzle().unwrap().id, 2);
        cache.get_puzzles(path, 2000, 3000, &None).unwrap();
        assert!(cache.get_next_puzzle().is_none());
        cache.get_puzzles(path, 1200, 1200, &None).unwrap();
        assert_eq!(cache.get_next_puzzle().unwrap().id, 3);
    }

    #[test]
    fn failed_database_open_returns_an_error_and_cache_recovers() {
        let dir = tempfile::tempdir().unwrap();
        let mut cache = PuzzleCache::new();
        assert!(cache
            .get_puzzles(dir.path().to_str().unwrap(), 0, 3000, &None)
            .is_err());
        let file = database(1, 1);
        assert!(next(&mut cache, &file).is_some());
    }

    #[test]
    fn deleting_a_database_invalidates_its_cached_puzzles() {
        let file = database(1, 3);
        let path = file.path().to_str().unwrap().to_owned();
        assert!(get_puzzle(path.clone(), 0, 3000, None).is_ok());
        delete_puzzle_database(path.clone()).unwrap();
        assert!(get_puzzle(path, 0, 3000, None).is_err());
    }
}
