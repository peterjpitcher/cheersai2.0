-- Add new UK hospitality-relevant events to the events table
-- These events were researched from UK food and drink calendars for 2025

INSERT INTO "public"."events" (
    "slug", "name", "aliases", "category", "alcohol_flag", "date_type", "rrule", "fixed_date", 
    "source_url", "uk_centric", "notes", "active", "dedupe_key"
) VALUES 

-- FOOD CATEGORY EVENTS
(
    'national-chip-week',
    'National Chip Week',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=20',
    null,
    'https://www.daysoftheyear.com/days/national-chip-week/',
    true,
    'Week-long celebration of chips (20-26 Feb); perfect for pub promotions',
    true,
    'national-chip-week'
),

(
    'british-yorkshire-pudding-day',
    'British Yorkshire Pudding Day',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=2;BYDAY=SU;BYSETPOS=1',
    null,
    'https://lovebuyingbritish.co.uk/events/national-food-weeks-and-days/',
    true,
    'First Sunday of February; traditional British roast accompaniment',
    true,
    'british-yorkshire-pudding-day'
),

(
    'real-bread-week-uk',
    'Real Bread Week (UK)',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=15',
    null,
    'https://www.sustainweb.org/realbread/real_bread_week/',
    true,
    'February 15-23; celebrates artisan and homemade bread',
    true,
    'real-bread-week-uk'
),

(
    'cornish-pasty-week',
    'Cornish Pasty Week',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=27',
    null,
    'https://lovebuyingbritish.co.uk/events/national-food-weeks-and-days/',
    true,
    'Late February into early March; celebrates the iconic Cornish pasty',
    true,
    'cornish-pasty-week'
),

(
    'british-cheese-week',
    'British Cheese Week',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=2',
    null,
    'https://www.britishcheeseawards.com/',
    true,
    'June 2-15; celebrates British cheese makers and varieties',
    true,
    'british-cheese-week'
),

(
    'national-ice-cream-day-uk',
    'National Ice Cream Day (UK)',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=7;BYDAY=SU;BYSETPOS=3',
    null,
    'https://thefoodiecalendar.co.uk/',
    true,
    'Third Sunday in July; perfect for summer dessert promotions',
    true,
    'national-ice-cream-day-uk'
),

(
    'world-pasta-day',
    'World Pasta Day',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=25',
    null,
    'https://www.worldpastaday.org/',
    true,
    'International celebration widely observed in UK restaurants',
    true,
    'world-pasta-day'
),

(
    'national-baking-week-uk',
    'National Baking Week (UK)',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=14',
    null,
    'https://www.awarenessdays.com/awareness-days-calendar/national-baking-week-2025/',
    true,
    'October 14-20; celebrates home baking and bakery businesses',
    true,
    'national-baking-week-uk'
),

(
    'national-chocolate-week-uk',
    'National Chocolate Week (UK)',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=MO;BYSETPOS=2',
    null,
    'https://www.chocolatier.co.uk/world-chocolate-days/',
    true,
    'Mid-October week celebrating chocolate; dessert menu focus',
    true,
    'national-chocolate-week-uk'
),

(
    'national-sausage-week-uk',
    'National Sausage Week (UK)',
    ARRAY[]::text[],
    'food',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3',
    null,
    'https://lovebuyingbritish.co.uk/events/national-food-weeks-and-days/',
    true,
    'November 3-9; celebrates British sausage making tradition',
    true,
    'national-sausage-week-uk'
),

(
    'british-pudding-day',
    'British Pudding Day',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=9',
    null,
    'https://lovebuyingbritish.co.uk/events/national-food-weeks-and-days/',
    true,
    'Celebrates traditional British puddings and desserts',
    true,
    'british-pudding-day'
),

(
    'national-sunday-roast-day',
    'National Sunday Roast Day',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=11;BYDAY=SU;BYSETPOS=1',
    null,
    'https://lovebuyingbritish.co.uk/events/national-food-weeks-and-days/',
    true,
    'First Sunday in November; celebrates the British Sunday roast tradition',
    true,
    'national-sunday-roast-day'
),

(
    'national-homemade-soup-day',
    'National Homemade Soup Day',
    ARRAY[]::text[],
    'food',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=4',
    null,
    'https://www.daysoftheyear.com/days/homemade-soup-day/',
    true,
    'International day widely celebrated in UK hospitality',
    true,
    'national-homemade-soup-day'
),

-- DRINK CATEGORY EVENTS
(
    'world-coffee-day',
    'World Coffee Day',
    ARRAY['International Coffee Day']::text[],
    'drink',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=1',
    null,
    'https://www.internationalcoffeeday.org/',
    true,
    'Official International Coffee Day by ICO; major hospitality activation',
    true,
    'world-coffee-day'
),

(
    'international-tea-day',
    'International Tea Day',
    ARRAY[]::text[],
    'drink',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=21',
    null,
    'https://www.un.org/en/observances/tea-day',
    true,
    'UN-designated day; perfect for afternoon tea promotions',
    true,
    'international-tea-day'
),

-- CIVIC CATEGORY EVENTS
(
    'world-vegan-day',
    'World Vegan Day',
    ARRAY[]::text[],
    'civic',
    false,
    'recurring',
    'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1',
    null,
    'https://www.vegansociety.com/',
    true,
    'Launches World Vegan Month; plant-based menu opportunities',
    true,
    'world-vegan-day'
),

(
    'food-drink-hospitality-week',
    'Food, Drink & Hospitality Week',
    ARRAY['IFE', 'HRC']::text[],
    'civic',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=17',
    null,
    'https://www.ife.co.uk/',
    true,
    'Major trade event at ExCeL London (17-19 March); industry networking',
    true,
    'food-drink-hospitality-week'
),

(
    'food-drink-expo-uk',
    'Food & Drink Expo',
    ARRAY['The Restaurant Show']::text[],
    'civic',
    false,
    'multi_day',
    'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=7',
    null,
    'https://www.ukhospitality.org.uk/',
    true,
    'April 7-9; supported by UKHospitality trade association',
    true,
    'food-drink-expo-uk'
);
