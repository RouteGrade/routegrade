"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { completeNativeAuth, onAuthDeepLink } from "@/lib/auth/native-auth";
import { isNativePlatform } from "@/lib/location";

/**
 * Catches the OAuth / magic-link callback arriving over the app's custom URL
 * scheme and finishes the sign-in inside the app.
 *
 * Mounted in the root layout rather than on the login screen: a magic-link
 * hand-off can cold-start the app on any route, and the app may have been
 * backgrounded on the run screen when the link was tapped.
 */
export function NativeAuthListener() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void onAuthDeepLink((url) => {
      void completeNativeAuth(url).then((result) => {
        // Not our callback — some other deep link. Leave it alone.
        if (result.status === "ignored") return;

        if (result.status === "failed") {
          router.replace("/login?error=callback");
          return;
        }

        router.replace(result.next);
        // The current page was server-rendered for a signed-out user. Without
        // a refresh the shell keeps showing "Sign in" until the next
        // navigation, which reads as the sign-in having silently failed.
        router.refresh();
      });
    }).then((off) => {
      // The effect may have been torn down while addListener was in flight.
      if (cancelled) {
        off();
        return;
      }
      unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [router]);

  return null;
}
