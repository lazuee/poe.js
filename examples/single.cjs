const { Poe } = require("../");

const poe = new Poe({
	token: "",
	bot_name: "Sage",
	// purge conversation by message count, once the queue has been emptied.
	purge_conversation: {
		enable: true,
		count: 0 // By default: 0, there are no messages to be purged.
	}
});

(async () => {
	// This function adds a request to a queue and waits for its turn to be executed.
	// The queue is implemented to prevent duplicated responses when sending requests to the chatbot.
	poe.send_message("What's your name?", {
		on_idling: () => console.log(`#1 - task running...`)
		///on_typing: (text) => console.log(`#1 - ${text}`)
	}).then((content) => {
		console.log(`#1 result: ${content}\n`);
	});

	const content = await poe.send_message("Dad joke related to programming.", {
		on_idling: () => console.log(`#2 - task running...`)
		//on_typing: (text) => console.log(`#2 - ${text}`)
	});

	console.log(`#2 result: ${content}\n`);

	(async () => {
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
		const content = await poe.send_message(conversation, {
			on_idling: () => console.log(`#3 - task running...`)
			//on_typing: (text) => console.log(`#3 - ${text}`)
		});

		console.log(`#3 result: ${content}\n`);
	})();
})();
