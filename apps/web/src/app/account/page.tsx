import { permanentRedirect } from "next/navigation";

/**
 * The account screen became the "You" tab in the app shell. Kept as a permanent
 * redirect so old links, bookmarks and any `?next=/account` auth callbacks
 * still land somewhere sensible.
 */
export default function AccountPage() {
  permanentRedirect("/you");
}
