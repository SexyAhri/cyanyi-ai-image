import type { AgentWebSearchStatus } from '../../lib/agent/agentWebSearch'

export function AgentStreamingCursor() {
  return (
    <span
      aria-label="正在思考"
      className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"
    >
      <span>正在思考</span>
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      </span>
    </span>
  )
}

export function AgentWebSearchInlineStatus({ status }: { status: AgentWebSearchStatus }) {
  return (
    <span className="inline-flex text-sm font-medium text-gray-500 dark:text-gray-400">
      <span className={status.completed ? undefined : 'agent-web-search-running-text'}>{status.text}</span>
    </span>
  )
}

export function AgentWebSearchStatusLines({ statuses }: { statuses: AgentWebSearchStatus[] }) {
  if (statuses.length === 0) return null
  return (
    <div className="mb-2 space-y-1">
      {statuses.map((status, index) => (
        <div key={`${status.text}-${index}`}>
          <AgentWebSearchInlineStatus status={status} />
        </div>
      ))}
    </div>
  )
}
