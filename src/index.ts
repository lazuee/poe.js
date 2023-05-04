// @ts-ignore
import { getRandom } from "random-useragent";
import { fileURLToPath } from "url";
import { ofetch } from "ofetch";

import fs from "fs";
import md5 from "md5";
import path from "path";
import WebSocket from "ws";

import type { AvailableBot, ChannelData, ChatOfBotDisplayName, Conversation, Promisable, Prompt } from "./types";
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

	private __ws_domain = `tch${Math.floor(Math.random() * 1e6)}`;
	private __formkey?: string;
	private __channel_data?: ChannelData;
	private __queries = new Map<string, string>();

	private __queue = new PQueue({ concurrency: 1 });
	private __queue_count = 0;

	private __bot_name: string;
	private __bot!: ChatOfBotDisplayName;

	constructor(options: {
		token: string;
		bot_name: string;
		purge_conversation?: {
			enable: boolean;
			count: number;
		};
	}) {
		this.__queue.on("idle", async () => {
			if (!this.__queue.size) {
				if (options?.purge_conversation?.enable) {
					// console.info("purging conversation in", this.__bot_name);
					await this.purge(options?.purge_conversation?.count ?? 50).catch(() => {});
				}
				this.__queue_count = 0;
			}
		});
		this.__bot_name = options?.bot_name;
		this.__headers.Cookie = "p-b=" + options?.token + "; Domain=poe.com";
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

	private async init(): Promise<void> {
		if (this.__formkey) return;

		// Fetch the home page and extract the form key and next data
		const html = await ofetch(this.__urls.home, {
			headers: this.__headers,
			parseResponse: (str) => str
		}).catch(() => null);
		if (!html) throw new Error("You've got ratelimit.");

		const json_regex = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;
		const json_text = json_regex.exec(html)?.[1] ?? "";
		const next_data = JSON.parse(json_text);
		this.__formkey = extractFormKey(html);

		const available_bots = next_data.props?.pageProps?.payload?.viewer?.availableBots as AvailableBot[];

		// Check if the token is valid
		if (!available_bots) throw new Error("Invalid token.");

		// Fetch the channel data from the settings page
		const settings = await ofetch<{ tchannelData: ChannelData }>(this.__urls.settings, {
			headers: this.__headers,
			parseResponse: JSON.parse
		});
		this.__channel_data = settings.tchannelData;

		// Fetch the chat data for each available bot
		for (const bot of available_bots.filter((bot) => bot.deletionState === "not_deleted")) {
			if (bot.displayName.toLocaleLowerCase() === this.__bot_name.toLocaleLowerCase()) {
				const url = `https://poe.com/_next/data/${next_data.buildId}/${bot.displayName}.json`;
				let chat_data: ChatOfBotDisplayName | undefined;

				while (!chat_data) {
					try {
						const data = await ofetch(url, {
							headers: this.__headers,
							parseResponse: JSON.parse
						});
						chat_data = data.pageProps.payload.chatOfBotDisplayName as ChatOfBotDisplayName;
						this.__bot = chat_data;
					} catch (error) {
						// console.warn(`Failed to fetch chat data for bot '${bot.displayName}'. Retrying in 5 seconds...`);
						await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
					}
				}
				break;
			}
		}

		if (!this.__bot) throw new Error("Invalid bot name.");
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

	private async disconnect_ws(ws: WebSocket) {
		return new Promise((resolve, reject) => {
			ws.onclose = () => {
				// console.info("Websocket now closed.");
				resolve(true);
			};

			try {
				ws.close();
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

	async subscribe() {
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

	async ask(prompt: Prompt, options?: { on_idling?: (count: number) => Promisable<void>; on_complete?: (count: number, response: string) => Promisable<void> }): Promise<string> {
		const result = await this.__queue.add(async () => {
			this.__queue_count++;

			if (typeof options?.on_idling === "function") options.on_idling(this.__queue_count);

			let response = "",
				ws = undefined as unknown as WebSocket,
				error = undefined as unknown as Error;

			try {
				await this.init();

				const timeout = setTimeout(async () => {
					await this.disconnect_ws(ws);
					error = new Error("Got timeout while waiting for bot response.");
				}, 2 * 60 * 1000);

				ws = await this.connect_ws();
				await this.subscribe();
				this.send_message(prompt);

				response = await this.get_message(ws);
				clearTimeout(timeout);
			} catch (err: any) {
				error = err?.stack ? err : new Error("Something went wrong while waiting for bot response.");
			} finally {
				if (ws) await this.disconnect_ws(ws);
				// wait 2.5 secs to prevent duplicated response
				await new Promise((resolve) => setTimeout(resolve, 2.5 * 1000));

				if (typeof options?.on_complete === "function") options.on_complete(this.__queue_count, response);
				if (error) throw error;
				return response;
			}
		});

		return result ?? "";
	}

	private async send_message(prompt: Prompt) {
		const get_prompt = (conversation: Conversation[]) => {
			const prompt_settings = [];

			for (const convo of conversation) if (convo.role === "system") prompt_settings.push(convo.content.trim());
			conversation = conversation.filter((convo) => convo.role !== "system");
			const latest = conversation.filter((convo) => convo.role === "user").pop();

			prompt = "";
			prompt += "**Prompt Settings**:\n\n";
			prompt += prompt_settings.join("\n\n") + "\n\n";
			prompt = prompt.trim();

			prompt += "\n\n**Conversation History**:\n\n";

			for (let convo of conversation.filter((c) => c?.role !== "user" || c === conversation[conversation.length - 1])) {
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

		return new Promise((resolve, reject) => {
			this.request("AddHumanMessageMutation", {
				bot: this.__bot.defaultBotObject.nickname,
				query: typeof prompt === "object" ? get_prompt(prompt) : prompt,
				chatId: this.__bot.chatId,
				source: null,
				withChatBreak: false
			})
				.then((message_data) => {
					if (!message_data.data?.messageCreateWithStatus?.messageLimit?.canSend) reject(new Error("Cannot send."));
					resolve(true);
				})
				.catch((error) => {
					reject(error);
				});
		});
	}

	private async get_message(ws: WebSocket): Promise<string> {
		return new Promise((resolve, reject) => {
			ws.onmessage = (e) => {
				const data = JSON.parse(e.data.toString());
				// Return early if the data does not contain any messages
				if (!Array.isArray(data.messages)) return;

				for (const message_str of data.messages) {
					const message_data = JSON.parse(message_str);

					// Skip messages that are not subscription updates
					if (message_data.message_type !== "subscriptionUpdate") continue;

					const message = message_data.payload?.data?.messageAdded;
					if (!message) reject(new Error("Added message is empty."));

					if (message?.author !== "human" && message?.state === "complete") {
						return resolve(message.text);
					}
				}
			};
			ws.onclose = () => {
				// console.info("Websocket got timeout");
				reject(new Error("You've reached the timeout, your request has been dismissed."));
			};
		});
	}

	async history(count = 25, cursor = null) {
		await this.init();

		try {
			const result = await this.request("ChatListPaginationQuery", {
				count,
				cursor,
				id: this.__bot.defaultBotObject.nickname
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
			// console.info(`Purging messages from ${chat_bot}`);

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
