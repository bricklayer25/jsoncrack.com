import React, { useState, useEffect } from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea} from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";
import { modify, applyEdits } from "jsonc-parser";


// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const getJson = useJson(state => state.getJson);
  const setJson = useJson(state => state.setJson);

  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState("");

  useEffect(() => {
    // reset editor when modal opens or selected node changes
    setEditing(false);
    setEditedText("");
  }, [opened, nodeData?.id]);

  const handleEdit = () => {
    setEditedText(normalizeNodeData(nodeData?.text ?? []));
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditedText("");
  };

  const handleSave = () => {
    if (!nodeData) return;

    let parsed: any;
    try {
      parsed = JSON.parse(editedText);
    } catch (e) {
      // If edited text is a primitive (e.g. number/string) try to coerce
      const trimmed = editedText.trim();
      if (/^[-]?[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
        parsed = Number(trimmed);
      } else if (trimmed === "true" || trimmed === "false") {
        parsed = trimmed === "true";
      } else if (trimmed === "null") {
        parsed = null;
      } else {
        // treat as string
        parsed = trimmed;
      }
    }

    const originalJson = getJson();
    const path = nodeData.path ?? [];

    try {
      // if the existing value at path is an object and the parsed edit is a (partial) object,
      // merge shallowly so nested object/array children that were not shown are preserved.
      let valueToWrite = parsed;
      try {
        const originalParsed = JSON.parse(originalJson);
        const getAtPath = (obj: any, p: any[]) => {
          let cur = obj;
          for (const seg of p) {
            if (cur == null) return undefined;
            cur = cur[seg as any];
          }
          return cur;
        };

        const existingValue = getAtPath(originalParsed, path as any[]);
        const isObject = (v: any) => v && typeof v === "object" && !Array.isArray(v);

        if (isObject(existingValue) && isObject(parsed)) {
          valueToWrite = { ...existingValue, ...parsed };
        }
      } catch (e) {
        // parsing original JSON failed — fall back to replacing with parsed
        valueToWrite = parsed;
      }

      const edits = modify(originalJson, path as any, valueToWrite, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });

      const newJson = applyEdits(originalJson, edits);
      // update shared json store (this will rebuild the graph)
      setJson(newJson);
      // also sync the left-hand editor contents so the text editor shows the change immediately
      useFile.setState({ contents: newJson, hasChanges: false });

      // try to re-select the same node after graph rebuild so the modal reflects current node data
      try {
        const nodes = useGraph.getState().nodes;
        const match = nodes.find(n => JSON.stringify(n.path) === JSON.stringify(path));
        if (match) {
          useGraph.getState().setSelectedNode(match);
        }
      } catch (err) {
        // ignore re-selection errors
      }

      setEditing(false);
      setEditedText("");
    } catch (err) {
      // if anything fails, keep editing mode open — better to surface error to user later
      // For now, just console.warn
      // eslint-disable-next-line no-console
      console.warn("Failed to apply edit to JSON", err);
    }
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Flex gap="xs" align="center">
              {!editing && (
                <Button size="xs" variant="outline" onClick={handleEdit}>
                  Edit
                </Button>
              )}
              {editing && (
                <>
                  <Button size="xs" onClick={handleSave}>
                    Save
                  </Button>
                  <Button size="xs" variant="subtle" onClick={handleCancel}>
                    Cancel
                  </Button>
                </>
              )}
              <CloseButton onClick={onClose} />
            </Flex>
          </Flex>

          <ScrollArea.Autosize mah={250} maw={600}>
            {!editing && (
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            )}

            {editing && (
              <Textarea
                minRows={6}
                styles={{ input: { fontFamily: "monospace" } }}
                value={editedText}
                onChange={e => setEditedText(e.currentTarget.value)}
              />
            )}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
