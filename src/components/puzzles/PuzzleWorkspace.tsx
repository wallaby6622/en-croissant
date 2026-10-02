import { lazy, Suspense } from "react";
import { useSessionStorage } from "@mantine/hooks";
import Puzzles from "./Puzzles";
const BookTraining = lazy(() => import("./books/BookTraining"));
export default function PuzzleWorkspace({ id }: { id: string }) {
  const [books, setBooks] = useSessionStorage({
    key: `${id}-book-workspace`,
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  return books ? (
    <Suspense fallback={null}>
      <BookTraining onBack={() => setBooks(false)} />
    </Suspense>
  ) : (
    <Puzzles id={id} onOpenBooks={() => setBooks(true)} />
  );
}
