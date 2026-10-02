import { Accordion, Anchor, Code, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import chessGraphLicense from "../../../public/licenses/chess-graph.txt?raw";
import reactFlowLicense from "../../../public/licenses/react-flow.txt?raw";
import dagreLicense from "../../../public/licenses/dagre.txt?raw";

const libraries = [
  {
    name: "Chess Graph",
    url: "https://github.com/NicoDeGiacomo/chess-graph",
    license: chessGraphLicense,
  },
  { name: "React Flow", url: "https://github.com/xyflow/xyflow", license: reactFlowLicense },
  { name: "Dagre", url: "https://github.com/dagrejs/dagre", license: dagreLicense },
];

export default function ThirdPartyLicenses() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Text size="lg" fw={500}>
        {t("Settings.Licenses")}
      </Text>
      <Text size="sm" c="dimmed">
        {t("Settings.Licenses.Desc")}
      </Text>
      <Accordion multiple defaultValue={["Chess Graph"]}>
        {libraries.map((library) => (
          <Accordion.Item key={library.name} value={library.name}>
            <Accordion.Control>{library.name} — MIT License</Accordion.Control>
            <Accordion.Panel>
              <Anchor href={library.url} target="_blank" rel="noreferrer">
                {library.name}
              </Anchor>
              <Code block mt="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {library.license}
              </Code>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
