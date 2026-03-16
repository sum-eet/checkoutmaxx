-- Add Slack and notification settings columns to Shop table for CouponMaxx V4
ALTER TABLE "Shop"
ADD COLUMN IF NOT EXISTS "slackWebhookUrl" text,
ADD COLUMN IF NOT EXISTS "slackChannelName" text,
ADD COLUMN IF NOT EXISTS "notificationSettings" jsonb,
ADD COLUMN IF NOT EXISTS "notificationEmail" text;
