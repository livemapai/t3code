import { createFileRoute } from "@tanstack/react-router";
import { AriSettings } from "../components/settings/AriSettings";
export const Route = createFileRoute("/_chat/settings/ari")({ component: AriSettings });
