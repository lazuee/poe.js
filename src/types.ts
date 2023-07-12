import type { AxiosProxyConfig } from "axios";

export type Promisable<T> = T | PromiseLike<T>;

export type Prompt = string | Conversation[];

export interface Conversation {
	role: "user" | "system" | "model";
	content: string;
	name?: string;
}

export interface ClientOptions {
	token: string;
	displayName: string;
	proxy?: AxiosProxyConfig;
	useragent?: string;
	request?: {
		maxRetries?: number;
		retryDelay?: number;
	};
	logger?: {
		info?: (...args: any[]) => void;
		warn?: (...args: any[]) => void;
		error?: (...args: any[]) => void;
	};
	prompt?: (conversation: Conversation[]) => string;
}

export interface Message {
	id: string;
	messageId: number;
	state: string;
	author: string;
	text: string;
	text_new: string;
	linkifiedText: string;
	contentType: string;
	suggestedReplies: string[];
	suggestedRepliesUpdated: number;
	creationTime: number;
	clientNonce: null;
	chat: {
		chatId: number;
		defaultBotNickname: string;
		id: string;
	};
	vote: null;
	voteReason: null;
	__isNode: string;
}
