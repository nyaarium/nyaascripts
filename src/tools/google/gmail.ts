import type { gmail_v1 } from "@googleapis/gmail";
import { z } from "zod";
import { getGmailClient } from "./lib/auth.ts";

function getHeader(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string | null {
	const header = payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
	return header?.value ?? null;
}

function decodeBody(part: gmail_v1.Schema$MessagePart): string | null {
	if (!part?.body?.data) return null;
	const data = part.body.data;
	try {
		return Buffer.from(data, "base64url").toString("utf8");
	} catch {
		try {
			return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
		} catch {
			return null;
		}
	}
}

function findBodyInPart(part: gmail_v1.Schema$MessagePart, preferHtml = false): string | null {
	if (part?.body?.data) return decodeBody(part);
	if (part?.parts?.length) {
		const textPart = part.parts.find((p) => p.mimeType === "text/plain");
		const htmlPart = part.parts.find((p) => p.mimeType === "text/html");
		const first = preferHtml ? (htmlPart ?? textPart) : (textPart ?? htmlPart);
		if (first) return findBodyInPart(first, preferHtml);
		return findBodyInPart(part.parts[0], preferHtml) ?? null;
	}
	return null;
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined, preferHtml = false): string | null {
	if (!payload) return null;
	if (payload?.body?.data) return decodeBody(payload);
	if (payload?.parts?.length) {
		const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
		const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
		const first = preferHtml ? (htmlPart ?? textPart) : (textPart ?? htmlPart);
		if (first) return findBodyInPart(first, preferHtml);
		for (const part of payload.parts) {
			const body = findBodyInPart(part, preferHtml);
			if (body) return body;
		}
	}
	return null;
}

function formatMessage(msg: gmail_v1.Schema$Message, preferHtml = false) {
	const payload = msg.payload ?? {};
	return {
		id: msg.id,
		threadId: msg.threadId,
		labelIds: msg.labelIds ?? [],
		snippet: msg.snippet ?? null,
		internalDate: msg.internalDate ?? null,
		subject: getHeader(payload, "Subject"),
		from: getHeader(payload, "From"),
		to: getHeader(payload, "To"),
		date: getHeader(payload, "Date"),
		body: extractBody(payload, preferHtml),
	};
}

export const gmailSearch = {
	name: "gmailSearch",
	title: "gmail-search",
	description: `
Search Gmail using Gmail search syntax.

Returns message ids and threadIds for use with gmail-fetch-messages.

Query examples:
- from:user@example.com
- subject:invoice
- is:unread
- after:2024/01/01
`.trim(),
	operation: "searching Gmail",
	schema: z.object({
		query: z
			.string()
			.optional()
			.default("")
			.describe(
				`
Gmail search query.

Leave empty for recent messages.

Examples:
- from:user@example.com
- subject:invoice
- is:unread
- after:2024/01/01
`.trim(),
			),
		maxResults: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.default(20)
			.describe(
				`
Max number of message ids to return.
`.trim(),
			),
		includeSpamTrash: z
			.boolean()
			.optional()
			.default(false)
			.describe(
				`
Include messages from spam and trash.
`.trim(),
			),
		pageToken: z
			.string()
			.optional()
			.describe(
				`
Page token from a previous search result to fetch the next page.
`.trim(),
			),
	}),
	async handler(_cwd: string, args: Record<string, unknown>) {
		const { query, maxResults, includeSpamTrash, pageToken } = gmailSearch.schema.parse(args);
		const { gmail } = await getGmailClient();

		const res = await gmail.users.messages.list({
			userId: "me",
			q: query || undefined,
			maxResults,
			includeSpamTrash,
			pageToken,
		});

		const messages = res.data.messages ?? [];
		const items = messages.map((m) => ({ id: m.id, threadId: m.threadId }));

		return {
			data: {
				messageIds: items,
				nextPageToken: res.data.nextPageToken ?? null,
				resultSizeEstimate: res.data.resultSizeEstimate ?? null,
			},
		};
	},
};

export const gmailFetchMessages = {
	name: "gmailFetchMessages",
	title: "gmail-fetch-messages",
	description: `
Fetch full email content by message ids.

Pass the id values from gmail-search results. Returns subject, from, to, date, body, snippet for each message.
`.trim(),
	operation: "fetching Gmail messages",
	schema: z.object({
		ids: z
			.array(z.string())
			.min(1)
			.max(51)
			.describe(
				`
Array of Gmail message ids from gmail-search (max 50).
`.trim(),
			),
		bodyFormat: z
			.enum(["plain", "html"])
			.optional()
			.default("plain")
			.describe(
				`
Body format: plain (default) or html.
`.trim(),
			),
	}),
	async handler(_cwd: string, args: Record<string, unknown>) {
		const { ids, bodyFormat } = gmailFetchMessages.schema.parse(args);
		const { auth } = await getGmailClient();
		const { token } = await auth.getAccessToken();
		if (!token) throw new Error("Failed to get access token");

		const BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";
		const boundary = `batch_${Math.random().toString(36).slice(2)}`;
		const pathPrefix = "/gmail/v1/users/me/messages/";

		const parts = ids.map(
			(id) =>
				`--${boundary}\r\nContent-Type: application/http\r\n\r\n` +
				`GET ${pathPrefix}${id}?format=full HTTP/1.1\r\n\r\n`,
		);
		const body = `${parts.join("")}--${boundary}--`;

		const res = await fetch(BATCH_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": `multipart/mixed; boundary=${boundary}`,
			},
			body,
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Gmail batch request failed: ${res.status} ${text}`);
		}

		const contentType = res.headers.get("Content-Type") ?? "";
		const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/);

		// The response boundary may differ from the one we sent; always parse it from the response Content-Type.
		const resBoundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? boundary).trim();

		const raw = await res.text();
		const escaped = resBoundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape for use in RegExp
		const chunks = raw.split(new RegExp(`\\r?\\n--${escaped}(?:--)?\\r?\\n`));

		const messages: ReturnType<typeof formatMessage>[] = [];

		// Finds the end of HTTP headers by locating the double-newline separator. Returns the index of the first body byte.
		const dbl = (s: string): number => {
			const i = s.indexOf("\r\n\r\n");
			return i >= 0 ? i + 4 : s.indexOf("\n\n") >= 0 ? s.indexOf("\n\n") + 2 : -1;
		};
		for (const chunk of chunks) {
			const inner = chunk.startsWith("--") ? chunk.replace(/^--[^\r\n]+\r?\n/, "") : chunk;
			const i1 = dbl(inner);
			if (i1 < 0) continue;
			const innerHttp = inner.slice(i1);
			const statusMatch = innerHttp.match(/HTTP\/[\d.]+\s+(\d+)/);
			if (statusMatch && statusMatch[1] !== "200") continue;
			const i2 = dbl(innerHttp);
			if (i2 < 0) continue;
			const jsonStr = innerHttp.slice(i2).trim();
			if (!jsonStr) continue;
			try {
				const msg = JSON.parse(jsonStr) as gmail_v1.Schema$Message;
				messages.push(formatMessage(msg, bodyFormat === "html"));
			} catch {
				// skip parse errors (e.g. error response body)
			}
		}

		return { data: messages };
	},
};
