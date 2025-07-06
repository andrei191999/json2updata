import { Box } from "@mui/material";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function PreviewPane({ xml }: { xml: string }) {
  return (
    <Box sx={{ p: 1, height: "100%", overflow: "auto" }}>
      <SyntaxHighlighter
        language="xml"
        style={atomDark}
        wrapLongLines
        customStyle={{ margin: 0, background: "inherit" }}
      >
        {xml}
      </SyntaxHighlighter>
    </Box>
  );
}
