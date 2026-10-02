import { Box, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconBook2, IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import classes from "./BookTrainingEntry.module.css";

export default function BookTrainingEntry({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <UnstyledButton className={classes.entry} mb="md" onClick={onClick}>
      <ThemeIcon size={44} radius="md" variant="light" className={classes.icon}>
        <IconBook2 size={25} stroke={1.6} aria-hidden="true" />
      </ThemeIcon>
      <Box className={classes.label}>
        <Text component="span" display="block" size="sm" fw={600} lh={1.4}>
          {t("Book.Title", { defaultValue: "Book puzzle training" })}
        </Text>
        <Text component="span" display="block" size="xs" c="dimmed" mt={3}>
          Learn · Review · Exam
        </Text>
      </Box>
      <IconChevronRight size={18} stroke={1.7} className={classes.arrow} aria-hidden="true" />
    </UnstyledButton>
  );
}
