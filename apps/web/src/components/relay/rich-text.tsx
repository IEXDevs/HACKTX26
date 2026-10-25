"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent output, rendered as Markdown: headings, lists, tables and code.
 * Models write Markdown by default, so this needs no extra prompt or tokens.
 * Raw HTML in the text is never rendered.
 */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`rich ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
