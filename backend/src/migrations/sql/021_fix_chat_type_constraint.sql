-- 021: corrige constraint de type em chat_channels ('direct' → 'dm')
ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_type_check;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_type_check
  CHECK (type IN ('dm','group','broadcast'));
