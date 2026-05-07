-- GI4: Add 'proposed' and 'dismissed' to goal_status enum for goal extraction proposals
ALTER TYPE goal_status ADD VALUE IF NOT EXISTS 'proposed';
ALTER TYPE goal_status ADD VALUE IF NOT EXISTS 'dismissed';
