import { Input } from "@particle-academy/react-fancy/input";
import { NumberField } from "@particle-academy/react-fancy/number-field";
import { Select } from "@particle-academy/react-fancy/select";
import { parseNumberText } from "./editing";
import type { FancyGridControls, FancyGridEditorProps } from "./types";

const INVALID = "border-red-500 focus:ring-red-500";

function TextCell({ editor, draft, onDraftChange, invalid, disabled, label }: FancyGridEditorProps) {
  return (
    <Input
      size="sm"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={invalid ? INVALID : undefined}
      disabled={disabled}
      placeholder={editor.placeholder}
      value={draft === null || draft === undefined ? "" : String(draft)}
      onValueChange={onDraftChange}
    />
  );
}

/**
 * NumberField so that blank is `null`, never `0`.
 *
 * It reports "blank" and "unreadable text" both as `null`, which is right for a
 * form but would turn a typo into an erased cell here. So the text itself is kept
 * as the draft until it says a number, and the grid's validation refuses it on
 * commit with the same words NumberField uses.
 */
function NumberCell({ editor, draft, onDraftChange, invalid, disabled, label }: FancyGridEditorProps) {
  if (editor.type !== "number") return null;
  const value = typeof draft === "number" ? draft : typeof draft === "string" ? parseNumberText(draft) : null;
  return (
    <NumberField
      size="sm"
      aria-label={label}
      className={invalid ? INVALID : undefined}
      disabled={disabled}
      placeholder={editor.placeholder}
      min={editor.min}
      max={editor.max}
      step={editor.step}
      value={value}
      onChange={(e) => onDraftChange(e.target.value.trim() === "" ? null : e.target.value)}
      onValueChange={(next) => {
        // A `null` here is blank or unreadable, and onChange has already said which.
        if (next !== null) onDraftChange(next);
      }}
    />
  );
}

function SelectCell({ editor, draft, onDraftChange, invalid, disabled, label }: FancyGridEditorProps) {
  if (editor.type !== "select") return null;
  const options = editor.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <Select
      size="sm"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={invalid ? INVALID : undefined}
      disabled={disabled}
      // An empty option only where empty is allowed: on a required column it could
      // only ever produce a refusal.
      list={editor.required ? options : [{ value: "", label: editor.placeholder ?? "" }, ...options]}
      placeholder={editor.required ? editor.placeholder : undefined}
      value={draft === null || draft === undefined ? "" : String(draft)}
      onValueChange={(next) => onDraftChange(next === "" ? null : next)}
    />
  );
}

/**
 * The grid's controls, built from `react-fancy`.
 *
 * ```tsx
 * import { fancyGridControls } from "@particle-academy/fancy-grid/controls";
 *
 * <FancyDataGrid controls={fancyGridControls} … />
 * ```
 *
 * On its own entry for the reason `./virtual` is: `react-fancy` is an OPTIONAL peer,
 * and an optional peer imported from the root entry is not optional. A read-only
 * grid never installs it.
 */
export const fancyGridControls: FancyGridControls = {
  text: TextCell,
  number: NumberCell,
  select: SelectCell,
};
