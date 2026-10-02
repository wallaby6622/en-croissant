//! Read-only book interchange and transactional user progress, kept in separate databases.
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, uci::UciMove, CastlingMode, Chess, Position};
use std::{collections::HashSet, path::Path};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Book {
    id: String,
    title: String,
    edition: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SolutionMove {
    uci: String,
    #[serde(default)]
    comment: String,
    #[serde(default)]
    children: Vec<SolutionMove>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Problem {
    id: String,
    order: i32,
    chapter: String,
    page: String,
    answer_page: String,
    number: String,
    fen: String,
    prompt: String,
    #[serde(default)]
    exam_prompt: Option<String>,
    #[serde(default)]
    hints: Vec<String>,
    #[serde(default)]
    explanation: String,
    #[serde(default)]
    themes: Vec<String>,
    solution: Vec<SolutionMove>,
}

fn validate_line(
    pos: &Chess,
    moves: &[SolutionMove],
    depth: usize,
    count: &mut usize,
) -> Result<()> {
    if moves.is_empty() || depth > 128 {
        return Err("Empty or excessively deep solution".into());
    }
    let mut siblings = HashSet::new();
    for node in moves {
        *count += 1;
        if *count > 4096 {
            return Err("Solution exceeds 4096 nodes".into());
        }
        if !siblings.insert(&node.uci) {
            return Err("Duplicate solution branch".into());
        }
        let uci: UciMove = node.uci.parse().map_err(|e| format!("Invalid UCI: {e}"))?;
        let mv = uci
            .to_move(pos)
            .map_err(|e| format!("Illegal move {}: {e}", node.uci))?;
        let mut next = pos.clone();
        next.play_unchecked(&mv);
        if node.children.is_empty() {
            if depth % 2 != 0 {
                return Err("Solution must end with the solver's move".into());
            }
        } else {
            validate_line(&next, &node.children, depth + 1, count)?;
        }
    }
    Ok(())
}
fn validate_problem(problem: &Problem) -> Result<()> {
    if problem.id.trim().is_empty()
        || problem.order < 1
        || problem.number.trim().is_empty()
        || problem.chapter.trim().is_empty()
        || problem.page.trim().is_empty()
        || problem.answer_page.trim().is_empty()
    {
        return Err("Missing problem ID, order, chapter, page, answer page, or number".into());
    }
    let fen: Fen = problem
        .fen
        .parse()
        .map_err(|e| format!("Invalid FEN: {e}"))?;
    let pos: Chess = fen
        .into_position(CastlingMode::Standard)
        .map_err(|e| format!("Invalid position: {e}"))?;
    validate_line(&pos, &problem.solution, 0, &mut 0)
}
fn read_book(path: &Path) -> Result<String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let (version, id, title, edition): (i32, String, String, String) = conn
        .query_row(
            "SELECT schema_version, book_id, title, edition FROM book_metadata WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| format!("Not a book puzzle database: {e}"))?;
    if version != 1 {
        return Err(format!("Unsupported book schema version: {version}"));
    }
    if id.trim().is_empty() || title.trim().is_empty() || edition.trim().is_empty() {
        return Err("Book ID, title and edition are required".into());
    }
    let mut stmt = conn.prepare("SELECT problem_id, sort_order, payload FROM book_problems ORDER BY sort_order, problem_id").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i32>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut problems = Vec::new();
    let mut rejected = Vec::new();
    let mut ids = HashSet::new();
    let mut orders = HashSet::new();
    for row in rows {
        let (id, order, data) = row.map_err(|e| e.to_string())?;
        if !ids.insert(id.clone()) || !orders.insert(order) {
            return Err("Duplicate problem ID or sort order".into());
        }
        let result = serde_json::from_str::<Problem>(&data)
            .map_err(|e| e.to_string())
            .and_then(|problem| {
                if problem.id != id || problem.order != order {
                    return Err("Row ID/order does not match payload".into());
                }
                validate_problem(&problem)?;
                Ok(problem)
            });
        match result {
            Ok(problem) => problems.push(problem),
            Err(reason) => rejected.push(serde_json::json!({"id": id, "reason": reason})),
        }
    }
    Ok(serde_json::json!({"book": Book { id, title, edition }, "problems": problems, "rejected": rejected}).to_string())
}

fn progress_connection(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS book_training_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
        INSERT OR IGNORE INTO book_training_state VALUES(1, 0, 'null');").map_err(|e| e.to_string())?;
    Ok(conn)
}
fn read_progress(path: &Path) -> Result<String> {
    let conn = progress_connection(path)?;
    let (revision, data): (i64, String) = conn
        .query_row(
            "SELECT revision, data FROM book_training_state WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let state: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"revision": revision, "state": state}).to_string())
}
fn write_progress(path: &Path, revision: i64, data: &str) -> Result<i64> {
    let state: serde_json::Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
    if state["version"] != 1
        || !state["books"].is_array()
        || !state["sessions"].is_array()
        || !state["cards"].is_object()
        || !state["logs"].is_array()
    {
        return Err("Unsupported or invalid training state".into());
    }
    let mut conn = progress_connection(path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx.execute("UPDATE book_training_state SET data=?1, revision=revision+1 WHERE id=1 AND revision=?2", params![data, revision]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("Training data changed in another window. Reload before continuing.".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(revision + 1)
}
fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("book-training.db3"))
}
#[tauri::command]
#[specta::specta]
pub async fn import_book_puzzles(file: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || read_book(Path::new(&file)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub async fn load_book_training(app: tauri::AppHandle) -> Result<String> {
    let path = state_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_progress(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub async fn save_book_training(app: tauri::AppHandle, revision: i32, data: String) -> Result<i32> {
    let path = state_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_progress(&path, revision as i64, &data).map(|n| n as i32)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn progress_is_atomic_and_rejects_stale_writers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.db3");
        assert!(read_progress(&path).unwrap().contains("\"revision\":0"));
        let state = r#"{"version":1,"books":[],"cards":{},"sessions":[],"logs":[]}"#;
        assert_eq!(write_progress(&path, 0, state).unwrap(), 1);
        assert!(write_progress(&path, 0, state).is_err());
        assert!(write_progress(&path, 1, "{}").is_err());
        let saved: serde_json::Value =
            serde_json::from_str(&read_progress(&path).unwrap()).unwrap();
        assert_eq!(saved["revision"], 1);
        assert_eq!(saved["state"]["version"], 1);
    }
    #[test]
    fn import_validates_positions_solutions_and_version_without_writing_source() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let conn = Connection::open(file.path()).unwrap();
        conn.execute_batch("CREATE TABLE book_metadata(id INTEGER, schema_version INTEGER, book_id TEXT, title TEXT, edition TEXT);
            INSERT INTO book_metadata VALUES(1,1,'book','Test','1');
            CREATE TABLE book_problems(problem_id TEXT, sort_order INTEGER, payload TEXT);").unwrap();
        let good = serde_json::json!({"id":"p1","order":1,"chapter":"1","page":"1","answerPage":"2","number":"1","fen":"7k/5K2/6Q1/8/8/8/8/8 w - - 0 1","prompt":"Mate","solution":[{"uci":"g6g7"}]});
        conn.execute(
            "INSERT INTO book_problems VALUES('p1',1,?1)",
            [good.to_string()],
        )
        .unwrap();
        conn.execute("INSERT INTO book_problems VALUES('p2',2,'{}')", [])
            .unwrap();
        let before = std::fs::read(file.path()).unwrap();
        let imported: serde_json::Value =
            serde_json::from_str(&read_book(file.path()).unwrap()).unwrap();
        assert_eq!(imported["problems"].as_array().unwrap().len(), 1);
        assert_eq!(imported["rejected"].as_array().unwrap().len(), 1);
        assert_eq!(before, std::fs::read(file.path()).unwrap());
        conn.execute("UPDATE book_metadata SET schema_version=2", [])
            .unwrap();
        assert!(read_book(file.path()).is_err());
    }
    #[test]
    fn external_demo_contract_round_trips_and_illegal_lines_are_excluded() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let conn = Connection::open(file.path()).unwrap();
        conn.execute_batch(include_str!("../../docs/book-puzzles/schema.sql"))
            .unwrap();
        let data: serde_json::Value =
            serde_json::from_str(include_str!("../../docs/book-puzzles/example.json")).unwrap();
        let book = &data["book"];
        conn.execute(
            "INSERT INTO book_metadata VALUES(1,1,?1,?2,?3)",
            params![
                book["id"].as_str().unwrap(),
                book["title"].as_str().unwrap(),
                book["edition"].as_str().unwrap()
            ],
        )
        .unwrap();
        for problem in data["problems"].as_array().unwrap() {
            conn.execute(
                "INSERT INTO book_problems VALUES(?1,?2,?3)",
                params![
                    problem["id"].as_str().unwrap(),
                    problem["order"].as_i64().unwrap(),
                    problem.to_string()
                ],
            )
            .unwrap();
        }
        let result: serde_json::Value =
            serde_json::from_str(&read_book(file.path()).unwrap()).unwrap();
        assert_eq!(result["problems"].as_array().unwrap().len(), 2);
        assert!(result["rejected"].as_array().unwrap().is_empty());
        let mut bad = data["problems"][0].clone();
        bad["solution"][0]["uci"] = serde_json::json!("g6g1");
        bad["solution"][0]["children"] = serde_json::json!([{"uci":"h8h1"}]);
        conn.execute(
            "UPDATE book_problems SET payload=?1 WHERE sort_order=1",
            [bad.to_string()],
        )
        .unwrap();
        let result: serde_json::Value =
            serde_json::from_str(&read_book(file.path()).unwrap()).unwrap();
        assert_eq!(result["problems"].as_array().unwrap().len(), 1);
        assert_eq!(result["rejected"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_identity_and_opponent_leaf_are_rejected() {
        let problem: Problem = serde_json::from_value(serde_json::json!({
            "id":"p", "order":1, "number":"1", "chapter":"1", "page":"1", "answerPage":"2",
            "fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "prompt":"Test",
            "solution":[{"uci":"e2e4","children":[{"uci":"e7e5"}]}]
        }))
        .unwrap();
        assert!(validate_problem(&problem).unwrap_err().contains("solver"));
        let file = tempfile::NamedTempFile::new().unwrap();
        let conn = Connection::open(file.path()).unwrap();
        conn.execute_batch("CREATE TABLE book_metadata(id INTEGER, schema_version INTEGER, book_id TEXT, title TEXT, edition TEXT);
            INSERT INTO book_metadata VALUES(1,1,'b','t','1'); CREATE TABLE book_problems(problem_id TEXT, sort_order INTEGER, payload TEXT);
            INSERT INTO book_problems VALUES('p',1,'{}'), ('p',2,'{}');").unwrap();
        assert!(read_book(file.path()).unwrap_err().contains("Duplicate"));
    }
}
