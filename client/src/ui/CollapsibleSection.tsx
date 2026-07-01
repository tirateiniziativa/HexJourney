import { useState, type ReactNode } from 'react'

/** Sezione della barra laterale comprimibile. Parte SEMPRE compressa; da
 * compressa mostra l'eventuale `summary` (poche info/azioni essenziali),
 * da espansa mostra `children`. */
export default function CollapsibleSection({
  title,
  summary,
  children,
  className,
}: {
  title: string
  /** contenuto ridotto mostrato quando è compressa (assente = niente) */
  summary?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`panel-section collapsible${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="collapsible-title">{title}</span>
      </button>
      {open ? children : summary}
    </div>
  )
}
