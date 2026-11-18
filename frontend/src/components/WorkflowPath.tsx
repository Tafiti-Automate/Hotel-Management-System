import type { CSSProperties } from 'react'
import { Icon } from './Icon'

export interface WorkflowPathStep {
  key: string
  label: string
  actor: string
  description: string
  icon: string
  disabled?: boolean
  count?: number
  blockedReason?: string
  nextAction?: string
}

interface WorkflowPathProps {
  title: string
  summary: string
  steps: WorkflowPathStep[]
  activeKey: string
  onSelect?: (key: string) => void
  onBlocked?: (step: WorkflowPathStep) => void
  badge?: string
}

export function WorkflowPath({ title, summary, steps, activeKey, onSelect, onBlocked, badge = 'Workflow' }: WorkflowPathProps) {
  return (
    <section className="workflow-path" style={container} aria-label={title}>
      <div className="workflow-path-header">
        <div>
          <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 650 }}>{title}</div>
          <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>{summary}</div>
        </div>
        <span style={{ flex: 'none', padding: '6px 10px', borderRadius: 20, color: 'var(--accent)', background: 'var(--accent-soft)', fontSize: 12, fontWeight: 600 }}>{badge}</span>
      </div>
      <div className="workflow-path-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(135px, 1fr))` }}>
        {steps.map((step, index) => {
          const active = step.key === activeKey
          const blocked = Boolean(step.disabled || step.blockedReason)
          const clickable = Boolean((blocked && onBlocked) || (!blocked && onSelect))
          return (
            <button
              key={step.key}
              type="button"
              disabled={blocked && !onBlocked}
              aria-disabled={blocked}
              title={step.blockedReason ? `${step.blockedReason}${step.nextAction ? ' Next: ' + step.nextAction : ''}` : step.description}
              onClick={clickable ? () => blocked ? onBlocked?.(step) : onSelect?.(step.key) : undefined}
              className={`workflow-path-step${active ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}`}
              aria-current={active ? 'step' : undefined}
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              <span className="workflow-path-number">{index + 1}</span>
              <span style={{ minWidth: 0 }}>
                <span className="workflow-path-actor">{step.actor}</span>
                <span className="workflow-path-label"><Icon name={step.icon} size={16} />{step.label}{step.count != null && <span style={{ marginLeft: 'auto', minWidth: 21, padding: '2px 6px', borderRadius: 20, color: active ? '#fff' : 'var(--accent)', background: active ? 'var(--accent)' : 'var(--accent-soft)', fontSize: 11.5, fontWeight: 850, textAlign: 'center' }}>{step.count}</span>}</span>
                <span className="workflow-path-description">{step.blockedReason || step.description}</span>
                {step.blockedReason && <span className="workflow-path-next">Next: {step.nextAction || 'Complete the preceding workflow stage.'}</span>}
              </span>
              {index < steps.length - 1 && <Icon name="chevron_right" size={17} color="var(--text-faint)" style={{ position: 'absolute', right: -13, top: 28, zIndex: 2 }} />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const container: CSSProperties = {
  marginBottom: 16,
  overflow: 'hidden',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-sm)',
}
