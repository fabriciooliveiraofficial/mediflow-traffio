-- 1. Grant Select Access to Tenant Members
CREATE POLICY "Members can view their tenant outbound queue" 
ON public.outbound_message_queue
FOR SELECT
USING (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
);

-- 2. Grant Insert Access to Tenant Members
CREATE POLICY "Members can insert into their tenant outbound queue" 
ON public.outbound_message_queue
FOR INSERT
WITH CHECK (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
);

-- 3. Grant Update Access to Tenant Members
CREATE POLICY "Members can update their tenant outbound queue" 
ON public.outbound_message_queue
FOR UPDATE
USING (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
)
WITH CHECK (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
);

-- 4. Grant Delete Access to Tenant Members
CREATE POLICY "Members can delete from their tenant outbound queue" 
ON public.outbound_message_queue
FOR DELETE
USING (
    tenant_id IN (
        SELECT tenant_id FROM public.members WHERE user_id = auth.uid()
    )
);
