// @ts-ignore
import { getRandom } from "random-useragent";
import { fileURLToPath } from "url";
import { ofetch } from "ofetch";

import fs from "fs";
import md5 from "md5";
import path from "path";
import WebSocket from "ws";

import type { Conversation, Promisable, Prompt } from "./types";
import PQueue from "p-queue-compat";

function extractFormKey(html: string) {
	const scriptRegex = /<script>if\(.+\)throw new Error;(.+)<\/script>/;
	const scriptText = html.match(scriptRegex)?.[1];
	const keyRegex = /var .="([0-9a-f]+)",/;
	const keyText = scriptText!.match(keyRegex)?.[1];
	const cipherRegex = /.\[(\d+)\]=.\[(\d+)\]/g;
	const cipherPairs = Array.from(scriptText!.matchAll(cipherRegex));

	const formKeyList = new Array(cipherPairs.length).fill("");
	for (const pair of cipherPairs) {
		const [formKeyIndex, keyIndex] = pair.slice(1).map(Number);
		formKeyList[formKeyIndex] = keyText![keyIndex];
	}
	const formKey = formKeyList.join("");

	return formKey as string;
}

class Poe {
	private __urls = {
		request: "https://poe.com/api/gql_POST",
		receive: "https://poe.com/api/receive_POST",
		home: "https://poe.com",
		settings: "https://poe.com/api/settings"
	};
	private __headers: Record<string, any> = {
		"User-Agent": getRandom(),
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		"Accept-Encoding": "gzip, deflate, br",
		"Accept-Language": "en-US,en;q=0.5",
		Dnt: "1",
		Te: "trailers",
		"Upgrade-Insecure-Requests": "1",

		// default
		Referrer: "https://poe.com/",
		Origin: "https://poe.com",
		Host: "poe.com",
		"Sec-Fetch-Dest": "empty",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Site": "same-origin",
		Connection: "keep-alive"
	};

	private __ws?: WebSocket;
	private __ws_domain = `tch${Math.floor(Math.random() * 1e6)}`;
	private __formkey?: string;
	private __channel_data?: Record<string, any>;
	private __queries = new Map<string, string>();

	private __queue = new PQueue({ concurrency: 1 });
	private __queue_pending = 0;

	private __bot_name: string;
	private __bot?: Record<string, any>;

	private __poe_token: string;

	constructor(options: {
		token: string;
		bot_name: string;
		purge_conversation?: {
			enable: boolean;
			count: number;
		};
	}) {
		this.__queue.on("idle", async () => {
			await new Promise((res) => setTimeout(res, 5 * 1000));

			if (!this.__queue.pending) {
				if (options?.purge_conversation?.enable) {
					console.info(`[${options?.token}] purging conversation in`, this.__bot_name);
					await this.purge(options?.purge_conversation?.count ?? 50).catch(() => {});
					await this.break_message();
				}
				this.__queue_pending = 0;
			}
		});
		this.__bot_name = options?.bot_name;
		this.__poe_token = options?.token;
		this.load_queries();
	}

	private load_queries() {
		const folder_path = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "graphql");
		const files = fs.readdirSync(folder_path);
		for (const filename of files) {
			const ext = path.extname(filename);
			if (ext !== ".graphql") continue;

			const query_name = path.basename(filename, ext);
			try {
				const query = fs.readFileSync(path.join(folder_path, filename), "utf-8");
				this.__queries.set(query_name, query);
			} catch (error: any) {
				console.warn(`Failed to load query '${query_name}': ${error.message}`);
			}
		}
	}

	get queue() {
		return this.__queue;
	}

	get pending() {
		return this.__queue_pending;
	}

	private async init(): Promise<void> {
		// Return if still has formkey
		if (this.__formkey && this.__bot) return;

		// Add the token to headers cookie
		this.__headers.Cookie = "p-b=" + this.__poe_token + "; Domain=poe.com";

		// Fetch the home page and extract the form key and next data
		let status = 0,
			html = "";

		await ofetch(this.__urls.home, {
			headers: this.__headers,
			onResponse: ({ response }) => {
				// console.log(response.status, "html");
				status = response.status;
				html = response._data;
			}
		}).catch(() => {});

		switch (status) {
			case 403: {
				// Got ratelimit, delete existing values
				delete this.__formkey;
				delete this.__channel_data;
				delete this.__bot;

				throw new Error("Token got ratelimit");
			}
			case 200: {
				const json_regex = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;
				const json_text = json_regex.exec(html)?.[1] ?? "";
				const next_data = JSON.parse(json_text);
				this.__formkey = extractFormKey(html);

				const bot_list = next_data.props?.pageProps?.payload?.viewer?.viewerBotList as Record<string, any>[];
				if (!bot_list)
					// Check if the token is valid
					throw new Error("Invalid token.");

				// Fetch the channel data from the settings page
				const settings = await ofetch<{ tchannelData: Record<string, any> }>(this.__urls.settings, {
					headers: this.__headers,
					parseResponse: JSON.parse
				});
				this.__channel_data = settings.tchannelData;

				// Fetch bot data
				this.__bot = await new Promise((resolve, reject) => {
					(async () => {
						while (true) {
							await ofetch(`https://poe.com/_next/data/${next_data.buildId}/${this.__bot_name}.json`, {
								headers: this.__headers,
								onResponse: ({ response }) => {
									if (response.status !== 200) return;
									resolve(response._data?.pageProps?.payload?.chatOfBotDisplayName as Record<string, any>);
								}
							}).catch(() => reject(new Error("Invalid Bot name")));

							await new Promise((res) => setTimeout(res, 5 * 1000));
						}
					})();
				});

				return;
			}
			default:
				break;
		}

		await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
		return await this.init();
	}

	private async connect_ws(): Promise<WebSocket> {
		if (!this.__channel_data) throw new Error("Channel data is empty.");

		const query = `min_seq=${this.__channel_data.minSeq}&channel=${this.__channel_data.channel}&hash=${this.__channel_data.channelHash}`;
		const url = `wss://${this.__ws_domain}.tch.${this.__channel_data.baseHost}/up/${this.__channel_data.boxName}/updates?${query}`;
		const headers = { "User-Agent": this.__headers["User-Agent"] };
		const ws = new WebSocket(url, { headers, rejectUnauthorized: false });

		return new Promise((resolve) => {
			ws.onopen = () => {
				// console.info("Websocket is ready...");
				return resolve(ws);
			};
		});
	}

	private async disconnect_ws() {
		return new Promise((resolve, reject) => {
			if (!this.__ws) return resolve(true);

			this.__ws.onclose = () => {
				console.info("Websocket closed.");
				delete this.__ws;
				resolve(true);
			};

			try {
				this.__ws.close();
			} catch (error) {
				reject(error);
			}
		});
	}

	private async request(queryName: string, variables: Record<string, any>, queryDisplayName?: string) {
		const query = this.__queries.get(queryName);
		if (!query) throw new Error(`Query '${queryName}' not found.`);
		if (!this.__channel_data) throw new Error("Channel data is empty.");
		if (!this.__formkey) throw new Error("Formkey is empty.");

		let result: Record<string, any> | undefined;
		const payload = { query, variables };
		if (queryDisplayName) (payload as any)["queryName"] = queryDisplayName;

		let attempts = 0;
		while (!result) {
			if (attempts === 20) throw new Error("Too many attempts.");
			attempts++;

			try {
				const headers = {
					"poe-formkey": this.__formkey ?? "",
					"poe-tchannel": this.__channel_data?.channel ?? "",
					"poe-tag-id": md5(JSON.stringify(payload) + this.__formkey + "WpuLMiXEKKE98j56k"),
					...this.__headers
				};

				const response = await ofetch<Record<string, any>>(this.__urls.request, {
					method: "POST",
					body: payload,
					headers
				});
				if (response.data) result = response;
				else {
					// console.warn(`Query '${queryName}' returned an error. Retrying in 5 seconds...`);
					await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
				}
			} catch (error) {
				// console.warn(`Query '${queryName}' failed. Retrying in 5 seconds...`);
				await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
			}
		}

		return result;
	}

	async send_message(prompt: Prompt, options?: { on_idling?: () => Promisable<void>; on_typing?: (response: string) => Promisable<void> }): Promise<string> {
		this.__queue_pending++;

		const result = await this.__queue.add(async () => {
			if (typeof options?.on_idling === "function") options.on_idling();

			let response = "",
				error = undefined as unknown as Error;

			try {
				await this.init();

				const timeout = setTimeout(() => {
					response = "[timeout]";
					this.disconnect_ws();
				}, 3 * 60 * 1000);
				if (!this.__ws) this.__ws = await this.connect_ws();
				await this.subscribe();

				const get_prompt = (conversation: Conversation[]) => {
					const prompt_settings = [];

					for (const convo of conversation) if (convo.role === "system") prompt_settings.push(convo.content.trim());
					conversation = conversation.filter((convo) => convo.role !== "system");
					const latest = conversation.filter((convo) => convo.role === "user").pop();
					if (latest) conversation = conversation.filter((convo) => convo !== latest);

					prompt = "";
					prompt += "**Prompt Settings**:\n\n";
					prompt += prompt_settings.join("\n\n") + "\n\n";
					prompt = prompt.trim();

					prompt += "\n\n**Conversation History**:\n\n";

					for (let convo of conversation) {
						switch (convo?.role) {
							case "model":
								if (!convo?.name) convo.name = this.__bot_name;
								prompt += `[${convo.name} - AI Model]: ${convo?.content ? convo.content.trim() : "No message"}\n\n`;
								break;
							case "user":
								if (!convo?.name) convo.name = "Unnamed";
								prompt += `[${convo.name} - User]: ${convo?.content ? convo.content.trim() : "No message"}\n\n`;
								break;
						}
					}
					prompt = prompt.trim();

					prompt += "\n\n**Latest User Message**:\n\n";
					if (latest) prompt += `${latest.content ? latest.content.trim() : "No message"}\n\n`;
					prompt = prompt.trim();

					prompt += "\n\n**Latest AI Model Response**:";

					return prompt.trim();
				};

				this.request("AddHumanMessageMutation", {
					bot: this.__bot?.defaultBotObject.nickname,
					query: typeof prompt === "object" ? get_prompt(prompt) : prompt,
					chatId: this.__bot?.chatId,
					source: null,
					withChatBreak: false
				});

				await this.get_message((text) => {
					response = text;
					if (typeof options?.on_typing === "function") options.on_typing(text);
				});

				clearTimeout(timeout);
			} catch (err: any) {
				error = err?.stack ? err : new Error("Something went wrong while waiting for bot response.");
			} finally {
				this.__queue_pending--;
				if (typeof response === "string" && response.length > 1 && response !== "[timeout]") {
					await new Promise((resolve) => setTimeout(resolve, 3 * 1000));
					if (error) throw error;
					return response;
				}

				await this.break_message();
				await this.disconnect_ws();
				console.log("[ask] response is empty, trying again,..");
				return await this.send_message(prompt, options);
			}
		});

		return result ?? "";
	}

	async break_message() {
		const result = await this.request("AddMessageBreakMutation", {
			chatId: this.__bot?.chatId
		});

		console.log(result.data);
		return result?.data?.messageBreakCreate?.message;
	}

	private async subscribe() {
		await this.request(
			"SubscriptionsMutation",
			{
				subscriptions: [
					{
						subscriptionName: "messageAdded",
						query: this.__queries.get("MessageAddedSubscription")
					},
					{
						subscriptionName: "viewerStateUpdated",
						query: this.__queries.get("ViewerStateUpdatedSubscription")
					},
					{
						subscriptionName: "viewerMessageLimitUpdated",
						query: this.__queries.get("ViewerMessageLimitUpdatedSubscription")
					}
				]
			},
			"subscriptionsMutation"
		);
	}

	private async get_message(on_typing?: (text: string) => void) {
		return new Promise((resolve, reject) => {
			if (!this.__ws) return reject(new Error("Websocket is null"));

			let completed = false;
			const onMessage = (data: any) => {
				const { messages } = JSON.parse(data.toString()) ?? {};
				// Return early if the data does not contain any messages
				if (!Array.isArray(messages)) return;

				for (const message_str of messages) {
					const message_data = JSON.parse(message_str);

					// Skip messages that are not subscription updates
					if (message_data.message_type !== "subscriptionUpdate") continue;

					const message = message_data.payload?.data?.messageAdded;
					if (message?.author === "human") return;

					if (message?.state !== "complete") {
						if (typeof message?.text === "string" && message?.text.length > 1) {
							if (typeof on_typing === "function") on_typing(message.text);
						}
					} else {
						if (completed) return;
						completed = true;

						this.__ws?.removeListener("message", onMessage);
						resolve(true);
					}
				}
			};
			this.__ws.on("message", onMessage);

			const onError = (error: Error) => {
				this.__ws?.removeListener("error", onError);
				reject(error);
			};
			this.__ws.on("error", onError);
		});
	}

	async history(count = 25, cursor = null) {
		await this.init();

		try {
			const result = await this.request("ChatListPaginationQuery", {
				count,
				cursor,
				id: this.__bot?.id
			});

			const messages = result?.data?.node?.messagesConnection?.edges;
			if (!messages) throw new Error("No messages found in result");

			return messages;
		} catch (error) {
			return null;
		}
	}

	async delete(...message_ids: (number | number[])[]) {
		await this.init();

		try {
			// Flatten the array of arrays and ensure each item is an integer
			const ids = message_ids
				.flat()
				.map((id) => parseInt(String(id)))
				.filter((id) => !isNaN(id));

			// If no valid message IDs are provided, return null
			if (ids.length === 0) return null;

			const result = await this.request("DeleteMessageMutation", {
				messageIds: ids
			});

			return result;
		} catch (error) {
			return null;
		}
	}

	async purge(count: number = -1) {
		try {
			// console.info(`Purging messages from ${this.__bot.defaultBotObject.displayName}`);

			// Set up a loop to delete messages in batches of 50
			let last_messages = (await this.history(50)).reverse();
			while (last_messages.length) {
				const message_ids = [];

				// Build an array of message IDs to delete
				for (const message of last_messages) {
					if (count === 0) break;
					count--;

					const message_id = message?.node?.messageId;
					if (message_id) message_ids.push(parseInt(message_id));
				}

				// Delete the messages
				await this.delete(message_ids);

				// If we've reached the message count limit, stop deleting messages
				if (count === 0) {
					// console.info(`Deleted ${message_ids.length} messages`);
					return;
				}

				// Get the next batch of messages to delete
				last_messages = (await this.history(50)).reverse();
			}

			// console.info('No more messages left to delete.');
			return;
		} catch (error) {
			return;
		}
	}
}

export { Conversation, Poe, Prompt };
