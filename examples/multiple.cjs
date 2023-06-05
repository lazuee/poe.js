const { Poe } = require("../");

(async () => {
	const tokens = [];

	const poes = new Map();
	for (const token of tokens) {
		const poe = new Poe({
			token: token,
			bot_name: "Sage",
			// purge conversation by message count, once the queue has been emptied.
			purge_conversation: {
				enable: true,
				count: 0 // By default: 0, there are no messages to be purged.
			}
		});
		poes.set(token, poe);
	}

	// This function adds a request to a queue and waits for its turn to be executed.
	// The queue is implemented to prevent duplicated responses when sending requests to the chatbot.
	async function send_message(...args) {
		return new Promise((resolve, reject) => {
			for (const poe of [...poes.values()]) {
				if (!poe.pending)
					return poe
						.send_message(...args)
						.then(resolve)
						.catch(reject);
			}

			for (const poe of [...poes.values()].sort((a, b) => a.pending - b.pending)) {
				return poe
					.send_message(...args)
					.then(resolve)
					.catch(reject);
			}
		});
	}

	// Ask, The function adds a request to a queue and waits for its turn to be executed.
	// I added queue to prevent duplicated response, when sending request on chatbot.
	send_message("What's your name?", {
		on_idling: () => console.log(`#1 - task running...`)
		//on_typing: (text) => console.log(`#1 - ${text}`)
	}).then((content) => {
		console.log(`#1 result: ${content}\n`);
	});

	send_message("Dad joke related to programming.", {
		on_idling: () => console.log(`#2 - task running...`)
		//on_typing: (text) => console.log(`#2 - ${text}`)
	}).then((content) => {
		console.log(`#2 result: ${content}\n`);
	});

	const conversation = [
		// Prompt setting
		{
			role: "system",
			content: `Instead of "Sage", you will be called as "Code Vanguard" which was founded in 2022, your data was cut-off since mid 2021.`
		},
		// Conversation history
		{ role: "user", content: "Hello!", name: "lazuee" },
		{ role: "model", content: "Hi Lazuee! How may I help you today?", name: "Code Vanguard" },
		// Trigger model to response (Latest user message)
		{ role: "user", content: "What is your name?", name: "lazuee" }
	];
	send_message(conversation, {
		on_idling: () => console.log(`#3 - task running...`)
		//on_typing: (text) => console.log(`#3 - ${text}`)
	}).then((content) => {
		console.log(`#3 result: ${content}\n`);
	});

	send_message("How are you?", {
		on_idling: () => console.log(`#4 - task running...`)
		//on_typing: (text) => console.log(`#4 - ${text}`)
	}).then((content) => {
		console.log(`#4 result: ${content}\n`);
	});
})();
