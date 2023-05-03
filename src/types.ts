export type Promisable<T> = T | PromiseLike<T>;

export type Model = "capybara" | "beaver" | "a2_2" | "a2" | "chinchilla" | "nutria" | "hutia";

export interface Conversation {
	role: "user" | "system" | "model";
	content: string;
	name?: string;
}

export interface ChannelData {
	minSeq: string;
	channel: string;
	channelHash: string;
	boxName: string;
	baseHost: string;
	targetUrl: string;
	enableWebsocket: boolean;
}

export type DeletionState = "not_deleted" | "user_deleted";

export interface ChatOfBotDisplayName {
	defaultBotObject: {
		displayName: string;
		id: string;
		hasWelcomeTopics: boolean;
		deletionState: DeletionState;
		image: {
			__typename: string;
			localName: string;
		};
		__isNode: "Bot";
		creator: null;
		description: string;
		poweredBy: string;
		messageLimit: {
			numMessagesRemaining: null;
			shouldShowRemainingMessageCount: boolean;
			dailyLimit: null;
			resetTime: number;
			dailyBalance: null;
		};
		nickname: string;
		hasSuggestedReplies: boolean;
		disclaimerText: string;
		isApiBot: boolean;
		contextClearWindowSecs: number;
		introduction: string;
		model: string;
		isSystemBot: boolean;
		isPrivateBot: boolean;
		viewerIsCreator: boolean;
		hasClearContext: boolean;
		isDown: boolean;
		handle: string;
		viewerIsFollower: boolean;
		isPromptPublic: boolean;
		promptPlaintext: string;
		botId: number;
		followerCount: number;
	};
	id: string;
	chatId: number;
	shouldShowDisclaimer: boolean;
	__isNode: string;
	messagesConnection: {
		edges: {
			node: {
				id: string;
				messageId: number;
				creationTime: number;
				text: string;
				author: string;
				linkifiedText: string;
				state: string;
				contentType: string;
				suggestedReplies: string[];
				vote: null;
				voteReason: null;
				chat: {
					chatId: number;
					defaultBotNickname: string;
					id: string;
				};
				__isNode: string;
				__typename: string;
			};
			cursor: string;
			id: string;
		}[];
		pageInfo: {
			hasPreviousPage: boolean;
			startCursor: string;
		};
		id: string;
	};
}

export interface AvailableBot {
	id: string;
	handle: string;
	displayName: string;
	messageLimit: {
		dailyLimit: number | null;
		monthlyLimit: number | null;
	};
	deletionState: DeletionState;
	image: {
		__typename: string;
		localName?: string;
		url?: string;
	} | null;
	__isNode: "Bot";
	isPrivateBot: boolean;
	viewerIsCreator: boolean;
}
