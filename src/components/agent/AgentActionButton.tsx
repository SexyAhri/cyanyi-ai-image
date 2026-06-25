import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import ViewportTooltip from '../common/ViewportTooltip'

export function AgentActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  onMouseDown,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={tooltip}
        onClick={(e) => {
          setTooltipVisible(false)
          onClick?.(e)
        }}
        onMouseDown={(e) => {
          setTooltipVisible(false)
          onMouseDown?.(e)
        }}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}
