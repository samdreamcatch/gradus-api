REVOKE EXECUTE ON FUNCTION public.can_subscribe_message_topic(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_subscribe_message_topic(text, uuid) TO authenticated;