alter table public.content_variants
  add constraint content_variants_content_item_id_key unique (content_item_id);
