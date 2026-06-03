import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { gmail } from "@googleapis/gmail";
import dotenv from "dotenv";
import express from "express";
import { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const AUTH_PORT = 8080;
const AUTH_PATH = "/oauth-google";
const SIGN_IN_URL = `http://localhost:${AUTH_PORT}${AUTH_PATH}`;

const scriptsDir = path.dirname(process.execPath);
const tokensDir = path.join(scriptsDir, ".tokens");
const gmailTokenPath = path.join(tokensDir, "gmail.json");

process.env.DOTENV_CONFIG_QUIET = "true";
dotenv.config({ path: path.join(scriptsDir, ".env"), override: false });

let authServer: Server | null = null;

function getOAuthCredentials(): { clientId: string; clientSecret: string } {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			`Gmail OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. ` +
				`Get them from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.`,
		);
	}
	return { clientId, clientSecret };
}

function getTokenPath(): string {
	return process.env.GOOGLE_TOKEN_PATH || gmailTokenPath;
}

function readToken(): object | null {
	const tokenPath = getTokenPath();
	if (!fs.existsSync(tokenPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
	} catch {
		return null;
	}
}

function writeToken(tokens: object): void {
	const tokenPath = getTokenPath();
	const dir = path.dirname(tokenPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf8");
}

/**
 * Start the one-off Express auth server. Returns the sign-in URL.
 * Server stays running until user completes OAuth callback.
 */
export async function startAuthServer(): Promise<string> {
	if (authServer) {
		return SIGN_IN_URL;
	}

	const { clientId, clientSecret } = getOAuthCredentials();
	const redirectUri = `http://localhost:${AUTH_PORT}${AUTH_PATH}`;

	const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: SCOPES,
		prompt: "consent",
	});

	const app = express();

	app.get(AUTH_PATH, async (req: express.Request, res: express.Response) => {
		const code = req.query.code as string | undefined;
		const error = req.query.error as string | undefined;

		if (error) {
			res.send(`<p>Authorization failed: ${error}</p><p>You may close this tab.</p>`);
			authServer?.close();
			authServer = null;
			return;
		}

		if (!code) {
			res.redirect(authUrl);
			return;
		}

		try {
			const { tokens } = await oauth2Client.getToken(code);
			writeToken(tokens);
			res.send(
				"<p>Gmail sign-in successful. Token saved.</p><p>You may close this tab and retry your original request.</p>",
			);
		} catch (err) {
			res.status(500).send(`<p>Error: ${(err as Error).message}</p>`);
		} finally {
			authServer?.close();
			authServer = null;
		}
	});

	app.use((_req: express.Request, res: express.Response) => {
		res.status(404).send("Not found");
	});

	await new Promise<void>((resolve, reject) => {
		authServer = app.listen(AUTH_PORT, "localhost", () => {
			resolve();
		});
		if (authServer) {
			authServer.on("error", reject);
		}
	});

	return SIGN_IN_URL;
}

export function getNeedsAuthMessage(): string {
	return `Gmail is not configured. Ask the user to sign in at ${SIGN_IN_URL} to authorize workspace email access. Once they confirm they have completed sign-in, retry this tool.`;
}

/**
 * Get authenticated Gmail client. Throws if not authorized.
 * When no token exists, starts the auth server and throws with a message containing the sign-in URL.
 */
export async function getGmailClient(): Promise<{
	gmail: ReturnType<typeof gmail>;
	auth: OAuth2Client;
}> {
	const { clientId, clientSecret } = getOAuthCredentials();
	const redirectUri = `http://localhost:${AUTH_PORT}${AUTH_PATH}`;

	const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

	const token = readToken();
	if (token) {
		oauth2Client.setCredentials(token);
		return { gmail: gmail({ version: "v1", auth: oauth2Client }), auth: oauth2Client };
	}

	await startAuthServer();
	throw new Error(getNeedsAuthMessage());
}
