-- Layer 3 (derived): the year-by-year strip itself, one row per
-- destination x window x historical year x day-of-window — populated
-- alongside weather_window_stats from the same raw weather_snapshots data.
--
-- Keyed on the raw (destination_id, window_start, window_end) triple, same
-- convention as the rest of this schema — see weather_snapshots.sql for
-- why no window-label column is used. day_offset is 0-indexed from
-- window_start, so a cell's actual calendar date for a given strip_year is
-- derived at read time rather than stored redundantly.
CREATE TABLE IF NOT EXISTS weather_strip_cells (
  destination_id      uuid NOT NULL REFERENCES destinations(id),
  window_start         date NOT NULL,
  window_end           date NOT NULL,
  strip_year           smallint NOT NULL,
  day_offset           smallint NOT NULL,
  cell_state           text NOT NULL,

  PRIMARY KEY (destination_id, window_start, window_end, strip_year, day_offset),
  CONSTRAINT valid_cell_state CHECK (cell_state IN ('dry', 'some_rain', 'washout'))
);
