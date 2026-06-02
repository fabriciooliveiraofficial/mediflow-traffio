-- Add location_id to clinic_info table
ALTER TABLE clinic_info ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE CASCADE;

-- Add index for performance
CREATE INDEX idx_clinic_info_location_id ON clinic_info(location_id);

-- Update RLS policies to ensure they still apply (they are tenant-based, so should be fine)
-- But let's verify if we need to add a policy for selecting by location
-- The existing policy for SELECT is usually:
-- CREATE POLICY "Users can view their own tenant's clinic info" ON clinic_info FOR SELECT USING (auth.uid() IN (SELECT user_id FROM members WHERE tenant_id = clinic_info.tenant_id));
-- This doesn't need to change as it's still tenant-bound.
