import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { join, extname, basename, dirname } from "path";
import { Agent as httpAgent } from "http";
import { Agent as httpsAgent } from "https";
import WebSocket from "ws";
import md5 from "md5";
import axios, { AxiosInstance, AxiosProxyConfig } from "axios";
import PQueue from "p-queue-compat";
import {
	ClientOptions,
	Conversation,
	Message,
	Promisable,
	Prompt,
} from "./types";
import {
	delay,
	extractFormKey,
	generateNonce,
	getValue,
	uuidv4,
} from "./utils";

let queries: Record<string, string> = {};
(() => {
	const folderPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"graphql"
	);
	const files = readdirSync(folderPath);
	for (const filename of files) {
		const ext = extname(filename);
		if (ext !== ".graphql") continue;

		const queryName = basename(filename, ext);
		const query = readFileSync(join(folderPath, filename), "utf-8");
		queries[queryName] = query;
	}
})();

export class Poe {
	#queue = new PQueue({ concurrency: 1 });
	#queue_pending = 0;

	#url = new URL("https://poe.com");
	#url_home = "/";
	#url_gql = "/api/gql_POST";
	#url_settings = "/api/settings";

	#formkey = "";
	#display_name: string;
	#request: AxiosInstance;
	#max_retries: any;
	#retry_delay: number;
	#headers: Record<string, any>;
	#proxy?: AxiosProxyConfig;
	#channel_data?: Record<string, any>;
	#next_data?: Record<string, any>;
	#chat_data?: Record<string, any>;
	#viewer?: Record<string, any>;
	#device_id?: string;
	#ws?: WebSocket;
	#ws_connected = false;
	#logger: {
		info?: (...args: any[]) => void;
		warn?: (...args: any[]) => void;
		error?: (...args: any[]) => void;
	};
	#prompt: (conversation: Conversation[]) => void;

	active_messages: Record<string, string | null> = {};
	message_queues: Record<string, Record<string, any>[]> = {};
	suggested_replies: Record<string, any[]> = {};
	suggested_replies_updated: Record<string, number> = {};

	viewerKey = "viewer";
	chatDataKey = "chatOfBotHandle";

	constructor(options: ClientOptions) {
		this.#logger = options?.logger ?? {};
		this.#display_name = options?.displayName ?? "Sage";
		this.#request = axios.create({
			baseURL: this.#url.origin,
			timeout: 60000,
			httpAgent: new httpAgent({ keepAlive: true }),
			httpsAgent: new httpsAgent({ keepAlive: true }),
		});
		this.#max_retries = options?.request?.maxRetries ?? 20;
		this.#retry_delay = options?.request?.retryDelay ?? 2000;

		this.#headers = {
			"User-Agent":
				options?.useragent ??
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.67",
			Referrer: this.#url.href,
			Host: this.#url.host,
			Origin: this.#url.origin,
			Cookie: `p-b=${options.token}; Domain=poe.com`,
		};
		this.#request.defaults.headers.common = this.#headers;

		this.#proxy = options.proxy;
		if (this.#proxy) {
			this.#request!.defaults.proxy = this.#proxy;
			this.#logger.info?.(`Proxy enabled: ${this.#proxy}`);
		}

		this.#request.interceptors.request.use((config) => {
			(config as any).retryCount = (config as any).retryCount ?? 0;
			return config;
		});
		this.#request.interceptors.response.use(
			(response) => response,
			(error) => {
				const { config, response } = error;

				if (
					[403, 404, 408, 500, 502, 503].some(
						(x) => x === response?.status
					) &&
					config.retryCount < this.#max_retries
				) {
					this.#logger.warn?.(
						`Retrying Request : ${config.retryCount}`
					);
					config.retryCount++;

					return new Promise((resolve) =>
						setTimeout(
							() => resolve(this.#request(config)),
							this.#retry_delay
						)
					);
				}

				return Promise.reject(error);
			}
		);

		this.#prompt =
			typeof options?.prompt === "function"
				? options?.prompt
				: (conversation: Conversation[]) => {
						const prompt_settings = [];

						for (const convo of conversation)
							if (convo.role === "system")
								prompt_settings.push(convo.content.trim());
						conversation = conversation.filter(
							(convo) => convo.role !== "system"
						);
						const latest = conversation
							.filter((convo) => convo.role === "user")
							.pop();
						if (latest)
							conversation = conversation.filter(
								(convo) => convo !== latest
							);

						let prompt = "";
						prompt += "**Prompt Settings**:\n\n";
						prompt += prompt_settings.join("\n\n") + "\n\n";
						prompt = prompt.trim();

						prompt += "\n\n**Conversation History**:\n\n";

						for (let convo of conversation) {
							switch (convo?.role) {
								case "model":
									if (!convo?.name)
										convo.name = this.#display_name;
									prompt += `[${convo.name} - AI Model]: ${
										convo?.content
											? convo.content.trim()
											: "No message"
									}\n\n`;
									break;
								case "user":
									if (!convo?.name) convo.name = "Unnamed";
									prompt += `[${convo.name} - User]: ${
										convo?.content
											? convo.content.trim()
											: "No message"
									}\n\n`;
									break;
							}
						}
						prompt = prompt.trim();

						prompt += "\n\n**Latest User Message**:\n\n";
						if (latest)
							prompt += `${
								latest.content
									? latest.content.trim()
									: "No message"
							}\n\n`;
						prompt = prompt.trim();

						prompt += "\n\n**Latest AI Model Response**:";

						return prompt.trim();
				  };
	}

	get pendingCount() {
		return this.#queue_pending;
	}

	async #reconnect() {
		if (!this.#ws_connected) {
			this.#logger.info?.("WebSocket died. Reconnecting...");
			this.#disconnectWS();
			await this.initialize();
		}
	}

	async initialize() {
		this.#next_data = await this.#getNextData();
		this.#channel_data = await this.#getChannelData();
		this.#chat_data = await this.#getChatData();
		this.#device_id = this.#getDeviceID();

		if (!this.#chat_data || !this.#viewer) {
			const missingDataKey = !this.#viewer ? "viewerKey" : "chatDataKey";
			throw new Error(
				`Poe API has changed! Please update the ${missingDataKey}.`
			);
		}

		await this.#subscribe();
		await this.#connectWS();
	}

	async destroy() {
		await this.#disconnectWS();
	}

	async #getNextData() {
		this.#logger.info?.("Downloading next_data...");

		try {
			const result = await this.#request.get(this.#url_home);
			const jsonRegex =
				/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;
			const jsonText = jsonRegex.exec(result["data"])![1];
			const nextData = JSON.parse(jsonText);

			this.#formkey = extractFormKey(result["data"]);
			this.#viewer = getValue(nextData, this.viewerKey, "object");

			return nextData;
		} catch (error) {
			this.#logger.error?.("Error occured in getNextData", error);
		}
	}

	async #getChannelData() {
		this.#logger.info?.("Downloading channel data...");
		try {
			const result = await this.#request.get(this.#url_settings);
			return result["data"].tchannelData;
		} catch (error) {
			this.#logger.error?.("Error occured in getChannelData", error);
		}
	}

	async #getChatData() {
		if (!this.#viewer?.uid) throw new Error("Invalid token.");

		this.#logger.info?.("Downloading chat data...");
		try {
			const result = await this.#request.get(
				`${this.#url.origin}/_next/data/${this.#next_data!.buildId}/${
					this.#display_name
				}.json`
			);
			return getValue(result["data"], this.chatDataKey, "object");
		} catch (error) {
			this.#logger.error?.("Failed to download chat data", error);
		}
	}

	#getDeviceID() {
		const userId = this.#viewer?.poeUser?.id;
		const device_id_path = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"poe_device.json"
		);
		const device_ids = existsSync(device_id_path)
			? JSON.parse(readFileSync(device_id_path, "utf8"))
			: {};

		if (device_ids.hasOwnProperty(userId)) return device_ids[userId];

		const device_id = uuidv4();
		device_ids[userId] = device_id;
		writeFileSync(device_id_path, JSON.stringify(device_ids, null, 2));

		return device_id;
	}

	async #subscribe() {
		this.#logger.info?.("Subscribing to mutations");
		await this.#send_query(
			"SubscriptionsMutation",
			{
				subscriptions: [
					{
						subscriptionName: "messageAdded",
						query: queries["MessageAddedSubscription"],
					},
					{
						subscriptionName: "viewerStateUpdated",
						query: queries["ViewerStateUpdatedSubscription"],
					},
					{
						subscriptionName: "viewerMessageLimitUpdated",
						query: queries["ViewerMessageLimitUpdatedSubscription"],
					},
				],
			},
			"subscriptionsMutation"
		);
	}

	async #send_query(
		queryName: string,
		variables: Record<string, any>,
		queryDisplayName?: string
	) {
		const payload = { query: queries[queryName], variables };
		if (queryDisplayName) (payload as any)["queryName"] = queryDisplayName;

		const headers = {
			"poe-formkey": this.#formkey ?? "",
			"poe-tchannel": this.#channel_data?.channel ?? "",
			"poe-tag-id": md5(
				JSON.stringify(payload) + this.#formkey + "WpuLMiXEKKE98j56k"
			),
			...this.#headers,
		};

		const result = await this.#request.post(this.#url_gql, payload, {
			headers,
		});

		return result.data;
	}

	async #connectWS() {
		if (!this.#channel_data) throw new Error("Channel data is empty.");
		const query = `?min_seq=${this.#channel_data.minSeq}&channel=${
			this.#channel_data.channel
		}&hash=${this.#channel_data.channelHash}`;
		const ws_domain = `tch${Math.floor(Math.random() * 1e6)}`;
		const ws_url = `wss://${ws_domain}.tch.${
			this.#channel_data.baseHost
		}/up/${this.#channel_data.boxName}/updates${query}`;

		this.#ws = new WebSocket(ws_url, {
			headers: { "User-Agent": this.#headers["User-Agent"]! },
			rejectUnauthorized: false,
		});

		await new Promise((resolve, reject) => {
			this.#ws!.on("open", () => {
				resolve(true);
			});

			this.#ws!.on("error", (error) => {
				reject(error);
			});
		});

		this.#ws.on("message", (message) => {
			this.#onMessage(message);
		});

		this.#ws.on("close", () => {
			this.#ws_connected = false;
		});

		this.#ws.on("error", (error) => {
			this.#logger.error?.("Error occurred in connectWS", error);
			this.#disconnectWS();
		});

		this.#ws_connected = true;
	}

	#disconnectWS() {
		if (this.#ws) this.#ws.close();
		this.#ws_connected = false;
	}

	async #onMessage(data: WebSocket.RawData) {
		try {
			const { messages } = JSON.parse(data.toString());
			if (!Array.isArray(messages)) return;

			for (const message_str of messages) {
				const message_data = JSON.parse(message_str);
				if (message_data?.message_type !== "subscriptionUpdate")
					continue;

				const message = message_data?.payload?.data?.messageAdded;
				if (!message) return;

				if (
					Array.isArray(message?.suggestedReplies) &&
					message?.suggestedReplies?.length
				) {
					if (
						!Array.isArray(
							this.suggested_replies[message.messageId]
						)
					)
						this.suggested_replies[message.messageId] = [];

					this.suggested_replies[message.messageId] = [
						...new Set([
							...this.suggested_replies[message.messageId],
							...message.suggestedReplies,
						]),
					];
					this.suggested_replies_updated[message.messageId] =
						Date.now();
				}

				const copiedDict = { ...this.active_messages };

				for (const [key, value] of Object.entries(copiedDict)) {
					if (
						value === message.messageId &&
						this.message_queues[key]
					) {
						this.message_queues[key].push(message);
						return;
					} else if (
						key !== "pending" &&
						value === null &&
						message.state !== "complete"
					) {
						this.active_messages[key] = message.messageId;
						this.message_queues[key].push(message);
					}
				}
			}
		} catch (error) {
			this.#logger.error?.("Error occurred in onMessage", error);
			this.#disconnectWS();
			await this.#connectWS();
		}
	}

	async #pingWS() {
		const pong = new Promise((resolve) => {
			if (this.#ws && this.#ws.readyState === WebSocket.OPEN)
				this.#ws.ping();
			this.#ws?.once("pong", () => resolve("ok"));
		});

		const timeout = new Promise((resolve) => {
			setTimeout(() => resolve("timeout"), 5000);
		});

		const result = await Promise.race([pong, timeout]);

		if (result === "ok") return true;
		else {
			this.#logger.warn?.("Websocket ping timed out.");
			this.#ws_connected = false;
			return false;
		}
	}

	async send_message(
		prompt: Prompt,
		options?: {
			withChatBreak?: boolean;
			timeout?: number;
			onRunning?: () => Promisable<any>;
			onTyping?: (message: Message) => Promisable<any>;
		}
	) {
		this.#queue_pending += 1;

		const result = await this.#queue.add(async () => {
			if (typeof options?.onRunning === "function")
				await options.onRunning();
			await this.#pingWS();
			await this.#reconnect();

			while (Object.values(this.active_messages).includes(null))
				await delay(10);

			this.active_messages["pending"] = null;

			const messageData = await this.#send_query("SendMessageMutation", {
				bot: this.#chat_data?.defaultBotObject?.model,
				query:
					typeof prompt === "object" ? this.#prompt(prompt) : prompt,
				chatId: this.#chat_data?.chatId,
				source: null,
				clientNonce: generateNonce(16),
				sdid: this.#device_id,
				withChatBreak: options?.withChatBreak ?? false,
			});

			delete this.active_messages["pending"];

			const errorMessage = (messageData?.errors ?? []).map(
				(e: any) => e?.message
			);
			if (errorMessage.includes("Server Error"))
				throw new Error(`Got server error while sending message.`);

			const humanMessage = messageData?.data?.messageEdgeCreate?.message;
			if (!humanMessage) {
				throw new Error(
					`Daily limit reached for ${this.#display_name}.`
				);
			}

			let humanMessageId = humanMessage?.node?.messageId ?? null;
			if (!humanMessageId)
				throw new Error(
					`Something went wrong while sending the message to ${
						this.#display_name
					}.`
				);

			this.active_messages[humanMessageId] = null;
			this.message_queues[humanMessageId] = [];

			let timeout = options?.timeout ?? 60;
			let lastText = "";
			let messageId;
			let message = {} as Message;
			while (true) {
				try {
					if (timeout == 0) throw new Error("Response timed out.");

					await delay(300);

					const _message =
						this.message_queues[humanMessageId].shift();
					if (!_message) {
						timeout -= 1;
						await delay(1000);
						continue;
					}

					if (_message["state"] === "complete") {
						if (lastText && _message["messageId"] === messageId)
							break;
						else continue;
					}

					_message["text_new"] = _message["text"].substring(
						lastText.length
					);
					lastText = _message["text"];
					messageId = _message["messageId"];

					const keys: (keyof Message)[] = [
						"id",
						"messageId",
						"state",
						"author",
						"text",
						"text_new",
						"linkifiedText",
						"contentType",
						"suggestedReplies",
						"suggestedRepliesUpdated",
						"creationTime",
						"clientNonce",
						"chat",
						"vote",
						"voteReason",
						"__isNode",
					];
					message = keys.reduce((obj, key) => {
						if (key in _message) (obj as any)[key] = _message[key];
						return obj;
					}, {} as Message);

					if (typeof options?.onTyping === "function")
						await options.onTyping(message as any);
				} catch (error) {
					delete this.active_messages[humanMessageId];
					delete this.message_queues[humanMessageId];
					throw error;
				}
			}

			message["suggestedReplies"] =
				this.suggested_replies[message["messageId"]] ?? [];
			message["suggestedRepliesUpdated"] =
				this.suggested_replies_updated[message["messageId"]] ?? null;

			delete this.active_messages[humanMessageId];
			delete this.message_queues[humanMessageId];
			this.#queue_pending -= 1;

			return message;
		});

		return result ?? null;
	}

	async break_message() {
		await this.#send_query("AddMessageBreakMutation", {
			chatId: this.#chat_data?.chatId,
		});
	}

	async history(count = 25, cursor = null): Promise<Record<string, any>[]> {
		try {
			const result = await this.#send_query("ChatListPaginationQuery", {
				count: count,
				cursor: cursor,
				id: this.#chat_data!["id"],
			});

			const messages =
				result?.data?.node?.messagesConnection?.edges ?? [];

			return messages;
		} catch (error) {
			return [];
		}
	}

	async delete(...message_ids: (number | number[])[]) {
		try {
			const ids = message_ids
				.flat()
				.map((id) => parseInt(String(id), 10))
				.filter((id) => !isNaN(id));

			if (ids.length === 0) return;

			await this.#send_query("DeleteMessageMutation", {
				messageIds: ids,
			});

			return;
		} catch (error) {
			return;
		}
	}

	async purge(count = -1) {
		try {
			let last_messages = (await this.history(50)).reverse();
			while (last_messages.length) {
				const message_ids = [];

				for (const message of last_messages) {
					if (count === 0) break;
					count--;

					const message_id = message?.node?.messageId;
					if (message_id) message_ids.push(parseInt(message_id));
				}

				if (message_ids.length > 0) await this.delete(message_ids);
				if (count === 0) return;

				last_messages = (await this.history(50)).reverse();
			}

			return;
		} catch (error) {
			return;
		}
	}

	async purge_all() {
		try {
			await this.#send_query(
				"SettingsDeleteAllMessagesButton_deleteUserMessagesMutation_Mutation",
				{}
			);
			return;
		} catch (error) {
			return;
		}
	}
}
