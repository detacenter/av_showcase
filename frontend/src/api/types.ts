export interface PlayEntry {
  played_at: string;
  track_id: string;
  track_name: string;
  album_id: string;
  album_name: string;
  album_type: string;
  album_total_tracks: number;
  artist_names: string[];
  artist_ids: string[];
  duration_ms: number;
  release_year: number;
  track_number: number;
  explicit: boolean;
  isrc: string | null;
  context_type: string | null;
  context_uri: string | null;
  device_name: string | null;
  device_type: string | null;
  shuffle_state: boolean | null;
  album_art_local_path: string | null;
  album_art_url: string | null;
  is_favorited: boolean;
  is_revisit: boolean;
}

export interface RecentResponse {
  entries: PlayEntry[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface AlbumTrackEntry {
  played_at: string;
  track_id: string;
  track_name: string;
  is_favorited: boolean;
  is_revisit: boolean;
}

export interface RecentAlbum {
  album_id: string;
  album_name: string;
  artist: string;
  release_year: number | null;
  art_local_path: string | null;
  art_url: string | null;
  art_filename?: string | null;
  dominant_color?: string | null;
  source?: "spotify" | "vinyl";
  vinyl_type?: string | null;
  tracklist?: { position: string; title: string; duration: string }[];
  entries: AlbumTrackEntry[];
}

export interface RecentAlbumsResponse {
  albums: RecentAlbum[];
}

export interface ArtistAlbum {
  album_id: string;
  art_filename: string | null;
  count: number;
  latest_played: string;
}

export interface Artist {
  name: string;
  play_count: number;
  latest_played: string;
  is_favorited: boolean;
  genres: string[];
  albums: ArtistAlbum[];
  hero_art_filename?: string | null;
}

export interface ArtistsResponse {
  artists: Artist[];
  all_genres: string[];
}

export interface TrackPlay {
  track_id: string;
  track_name: string;
  track_number: number;
  play_count: number;
  is_favorited: boolean;
}

export interface ArtistAlbumDetail {
  album_id: string;
  album_name: string;
  artist: string;
  art_filename: string | null;
  release_year: number | null;
  album_type: string | null;
  album_total_tracks: number | null;
  count: number;
  classified_type: string;
  is_favorited: boolean;
  rating: number;
  notes?: string;
  heard_tracks: number;
  track_plays: TrackPlay[];
}

export interface VinylTrack {
  position: string;
  title: string;
  duration: string;
}

export interface VinylRecord {
  release_id: number;
  title: string;
  artists: string[];
  art_filename: string | null;
  year: number | null;
  original_year: number | null;
  released?: string | null;
  country?: string | null;
  labels: string[];
  catnos: string[];
  genres?: string[];
  styles?: string[];
  formats: string[];
  format_descriptions: string[];
  tracklist: VinylTrack[];
  vinyl_type: string;
  community_have?: number;
  community_want?: number;
  community_rating_avg?: number;
  community_rating_count?: number;
  date_added?: string | null;
  user_rating?: number;
  notes?: string;
  barcode?: string | null;
  matrix?: string | null;
}

export interface VinylResponse {
  records: VinylRecord[];
  all_genres: string[];
}

export interface TopTrack {
  track_id: string;
  track_name: string;
  count: number;
}

export interface AlbumSummary {
  album_id: string;
  album_name: string;
  artist: string;
  art_filename: string | null;
  release_year: number | null;
  album_type: string | null;
  album_total_tracks: number | null;
  latest_played: string;
  count: number;
  classified_type: string;
  has_vinyl: boolean;
  is_favorited: boolean;
  rating: number;
  notes: string;
  genres: string[];
  heard_tracks: number;
  track_plays: TrackPlay[];
}

export interface AlbumsResponse {
  albums: AlbumSummary[];
  all_genres: string[];
  year_bounds: { min: number; max: number } | null;
}

export interface Condition {
  field: string;
  op: string;
  value?: string | boolean | number | null;
  values?: string[];
  from?: number;
  to?: number;
}

export interface RuleGroup {
  conditions: Condition[];
}

export interface Playlist {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  rule_groups: RuleGroup[];
  pinned_track_ids: string[];
  excluded_track_ids: string[];
  track_count: number;
  art_filenames: string[];
}

export interface PlaylistTrack {
  track_id: string;
  track_name: string;
  artist_names: string[];
  album_name: string;
  release_year: number | null;
  _play_count: number;
  _pinned: boolean;
}

export interface SessionInfo {
  id: string;
  label: string;
  track_count: number;
}

export interface AppSettings {
  accent_color: string;
  splash_style: string;
  app_icon: string;
  sidebar_logo: string;
  auto_poll: boolean;
}

export interface ArtistDetail {
  name: string;
  play_count: number;
  artist_id: string | null;
  genres: string[];
  is_favorited: boolean;
  albums: ArtistAlbumDetail[];
  top_tracks: TopTrack[];
  vinyl: VinylRecord[];
}
