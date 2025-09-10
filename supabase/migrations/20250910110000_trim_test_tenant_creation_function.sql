-- Trim unused variables from test function to silence lints

CREATE OR REPLACE FUNCTION public.test_tenant_creation_now()
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'status', 'warning',
    'message', 'This is a test function and should not be used in production'
  );
END;
$$;

