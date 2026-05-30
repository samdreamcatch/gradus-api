import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface BaseProps {
  label: string;
  value: string;
  onCommit: (next: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  saving?: boolean;
  className?: string;
  inputClassName?: string;
  displayClassName?: string;
  autoEdit?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  /** When true, applies a pen-highlight underline + accent wash to flag voice-touched fields. */
  highlighted?: boolean;
}


interface TextFieldProps extends BaseProps {
  kind: "text";
}
interface TextareaFieldProps extends BaseProps {
  kind: "textarea";
  rows?: number;
}
interface SelectFieldProps extends BaseProps {
  kind: "select";
  options: string[];
  allowFreeText?: boolean;
}

export type MoveFieldProps = TextFieldProps | TextareaFieldProps | SelectFieldProps;

export function MoveField(props: MoveFieldProps) {
  const {
    label,
    value,
    onCommit,
    placeholder,
    disabled,
    saving,
    className,
    inputClassName,
    displayClassName,
    autoEdit,
    required,
    hideLabel,
    highlighted,
  } = props;

  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ("select" in inputRef.current) inputRef.current.select?.();
    }
  }, [editing]);

  const commit = async (override?: string) => {
    const source = override !== undefined ? override : draft;
    const next = source.trim();
    if (required && !next) {
      setDraft(value);
      setEditing(false);
      return;
    }
    if (next === value) {
      setEditing(false);
      return;
    }
    await onCommit(next);
    setEditing(false);
  };


  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };
  const labelEl = hideLabel ? null : (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-text-tertiary">
        {label}
      </span>
      {saving ? (
        <span className="text-[10px] font-medium text-text-tertiary">Saving…</span>
      ) : null}
    </div>
  );


  if (!editing) {
    return (
      <div className={cn("group space-y-1.5", className)}>
        {labelEl}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className={cn(
            "block w-full border-b border-divider bg-transparent px-1 py-1 text-left transition-colors",
            "hover:border-accent/50",
            "text-text-primary",
            highlighted && "border-accent rounded-sm",
            displayClassName,
          )}
          style={
            highlighted
              ? {
                  backgroundColor: "color-mix(in oklab, var(--accent) 14%, transparent)",
                }
              : undefined
          }
        >
          {value ? (
            <span className="whitespace-pre-wrap break-words">{value}</span>
          ) : (
            <span className="text-text-tertiary italic">{placeholder ?? "Tap to add"}</span>
          )}
        </button>

      </div>
    );
  }

  const sharedInputCls = cn(
    "block w-full border-b-2 border-accent bg-transparent px-1 py-1 text-text-primary",
    "focus:outline-none",
    inputClassName,
  );




  return (
    <div className={cn("space-y-1", className)}>
      {labelEl}
      {props.kind === "text" && (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}

          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder={placeholder}
          className={sharedInputCls}
        />
      )}
      {props.kind === "textarea" && (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          value={draft}
          rows={props.rows ?? 3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}

          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder={placeholder}
          className={cn(sharedInputCls, "resize-y")}
        />
      )}
      {props.kind === "select" && (
        <SelectOrCombo
          value={draft}
          options={props.options}
          allowFreeText={props.allowFreeText !== false}
          onChange={setDraft}
          onCommit={(override) => commit(override)}
          onCancel={cancel}
          placeholder={placeholder}
          inputClassName={sharedInputCls}
          inputRef={(el) => {
            inputRef.current = el;
          }}
        />

      )}
    </div>
  );
}

function SelectOrCombo({
  value,
  options,
  allowFreeText,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  inputClassName,
  inputRef,
}: {
  value: string;
  options: string[];
  allowFreeText: boolean;
  onChange: (v: string) => void;
  onCommit: (override?: string) => void;

  onCancel: () => void;
  placeholder?: string;
  inputClassName?: string;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const CUSTOM = "__custom__";
  const isCustom = value !== "" && !options.includes(value);
  const [mode, setMode] = useState<"select" | "text">(isCustom ? "text" : "select");

  if (mode === "text") {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit()}

        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className={inputClassName}
        autoFocus
      />
    );
  }

  return (
    <select
      value={value}
      autoFocus
      onChange={(e) => {
        const v = e.target.value;
        if (v === CUSTOM) {
          setMode("text");
          onChange("");
          return;
        }
        onChange(v);
        onCommit(v);

      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={cn(inputClassName, "appearance-none pr-8 bg-[length:16px] bg-no-repeat bg-[right_0.5rem_center]")}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
      }}
    >
      {value === "" ? (
        <option value="" disabled>
          {placeholder ?? "Select…"}
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {allowFreeText ? (
        <option value={CUSTOM}>Custom…</option>
      ) : null}
    </select>
  );
}

