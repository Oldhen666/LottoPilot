-- Phase 2: ALC TAG as independent nightly companion game
-- lottery_id='alc_tag', draw_date = nightly date, tag_number = 6-digit result

INSERT INTO lotteries (id, name, country, draw_frequency, main_count, main_min, main_max, special_count, special_min, special_max, source_url, draw_schedule) VALUES
('alc_tag', 'Atlantic TAG', 'CA', 'nightly', 6, 0, 9, 0, NULL, NULL, 'https://alc.ca/content/alc/en/our-games/lotto/tag.html', '{"time":"23:29:59","timezone":"America/Halifax"}')
ON CONFLICT (id) DO NOTHING;

-- alc_tag draws: winning_numbers can be [] or digits; tag_number stores the 6-digit result
-- Scraper will upsert with lottery_id='alc_tag', draw_date, tag_number, winning_numbers=[]
