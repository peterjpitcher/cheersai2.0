do $$
declare
  v_table text;
  v_column text;
  v_type text;
  v_nullable text;
  v_default text;
begin
  foreach v_table in array array['meta_campaigns', 'ad_sets', 'ads'] loop
    foreach v_column in array array['metrics_reactions', 'metrics_comments', 'metrics_shares'] loop
      select data_type, is_nullable, column_default
        into v_type, v_nullable, v_default
        from information_schema.columns
       where table_schema = 'public'
         and table_name = v_table
         and column_name = v_column;

      if v_type is null then
        raise exception '%.% missing', v_table, v_column;
      end if;

      if v_type <> 'integer' then
        raise exception '%.% must be integer', v_table, v_column;
      end if;

      if v_nullable <> 'NO' then
        raise exception '%.% must be not null', v_table, v_column;
      end if;

      if v_default is distinct from '0' then
        raise exception '%.% default must be 0', v_table, v_column;
      end if;
    end loop;
  end loop;
end $$;
