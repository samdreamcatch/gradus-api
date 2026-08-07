import ReactMarkdown, { type Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-relaxed text-text-primary last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-text-primary first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-text-primary first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-text-primary first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-text-primary first:mt-0">{children}</h4>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-4 list-disc space-y-1 text-sm leading-relaxed text-text-primary marker:text-text-tertiary last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm leading-relaxed text-text-primary marker:text-text-tertiary last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent-ink underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-accent/40 pl-3 text-sm italic text-text-secondary last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-text-primary">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-elevated p-3 font-mono text-[12px] text-text-primary last:mb-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-divider" />,
};

export function AnswerMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
