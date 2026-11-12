// Provider-only typography: other notification channels retain their original text.
export function formatDingTalkInventoryMarkdown(text) {
  if (typeof text !== "string") return text;
  let inventoryTable = false;
  return text.split("\n").map(line => {
    if (line.replace(/\s/g, "") === "|货品名称|SKU|库存/销量|可售<br>天数|预警|") inventoryTable = true;
    if (!line.startsWith("|")) { inventoryTable = false; return line; }
    if (!inventoryTable || /^\|[-:| ]+\|$/.test(line)) return line;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 5) return line;
    for (const index of [1, 2]) cells[index] = '<font size="2">' + cells[index] + '</font>';
    return "| " + cells.join(" | ") + " |";
  }).join("\n");
}
