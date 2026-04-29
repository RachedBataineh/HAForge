import type { AppRouter } from "@HAForge/api/routers/index";
import { env } from "@HAForge/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const message = error.message;

      if (message.includes("Authentication required") || message.includes("UNAUTHORIZED")) {
        toast.error("Session expired. Please log in again.");
        window.location.href = "/login";
        return;
      }

      if (message.includes("rate limit") || message.includes("429") || message.includes("Too many requests")) {
        toast.error("Too many requests. Please wait a moment and try again.");
        return;
      }

      toast.error(message, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
  defaultOptions: {
    mutations: {
      onError: (error) => {
        const message = error.message;

        if (message.includes("Authentication required") || message.includes("UNAUTHORIZED")) {
          toast.error("Session expired. Please log in again.");
          window.location.href = "/login";
          return;
        }

        if (message.includes("rate limit") || message.includes("429") || message.includes("Too many requests")) {
          toast.error("Too many requests. Please wait a moment and try again.");
          return;
        }

        toast.error(message);
      },
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.NEXT_PUBLIC_SERVER_URL}/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
