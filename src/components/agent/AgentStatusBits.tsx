import type { AgentWebSearchStatus } from '../../lib/agent/agentWebSearch'

export function AgentStreamingCursor() {
  return (
    <span
      aria-label="正在生成"
      className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 align-baseline dark:bg-blue-400"
    />
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
