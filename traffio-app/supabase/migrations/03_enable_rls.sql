-- Enable RLS
alter table conversation_sessions enable row level security;
alter table conversation_messages enable row level security;
alter table ai_audit_logs enable row level security;

-- Policy: Tenants can only see their own sessions
create policy "Tenants viewing own sessions"
on conversation_sessions for select
using (
  tenant_id in (
    select tenant_id from members where user_id = auth.uid()
  )
);

-- Policy: Chat History
create policy "Tenants viewing messages"
on conversation_messages for select
using (
  session_id in (
    select id from conversation_sessions 
    where tenant_id in (
      select tenant_id from members where user_id = auth.uid()
    )
  )
);

-- Policy: Audit Logs
create policy "Tenants viewing audit logs"
on ai_audit_logs for select
using (
  tenant_id in (
    select tenant_id from members where user_id = auth.uid()
  )
);
