/***************************
 *          UROŠ           *
 *  DISCORD TIMETABLE BOT  *
 ***************************/
// Invite link:
// https://discord.com/api/oauth2/authorize?client_id=770964922720321546&permissions=8&scope=bot

const Discord = require('discord.js');
const bot = new Discord.Client();
const client = bot; // alias
const fs = require('fs'); // FILE SYSTEM
require('dotenv').config({path: __dirname + '/.env'}); // env variables (client secret)
const fetch = require('node-fetch'); // to fetch timetable and moodle events
const CronJob = require('cron'); // send messages every day
const moment = require('moment-timezone') // praise devs who work with time

TESTING_CHANNEL = process.env["TESTING_CHANNEL"];
if (!TESTING_CHANNEL) console.log("Missing TESTING_CHANNEL");
NOTIFICATION_CHANNEL = process.env["NOTIFICATION_CHANNEL"];
if (!NOTIFICATION_CHANNEL) console.log("Missing NOTIFICATION_CHANNEL");
notification_backup = NOTIFICATION_CHANNEL; // this is used to restore from testing mode (when NOTIFICATION_CHANNEL is set to equal TESTING_CHANNEL)

URNIK_API_URL = process.env["URNIK_API_URL"];
if (!URNIK_API_URL) console.log("Missing URNIK_API_URL");
MOODLE_API_URL = process.env["MOODLE_API_URL"];
if (!MOODLE_API_URL) console.log("Missing MOODLE_API_URL");
AVATAR_URL = process.env["AVATAR_URL"];
if (!AVATAR_URL) console.log("Missing AVATAR_URL");

// if running multiple instances, use this ID to differentiate between them
CLIENT_ID = process.env["CLIENT_ID"];
if (!CLIENT_ID) console.log("Missing CLIENT_ID");

// the userid that may use direct eval()
ADMIN_ID = process.env["ADMIN_ID"];
if (!ADMIN_ID) console.log("Missing ADMIN_ID");

function testing(enable) {
	const testing = bot.channels.get(TESTING_CHANNEL);
	if (enable) {
		NOTIFICATION_CHANNEL = TESTING_CHANNEL;
		testing.send("Testing mode enabled.");
		bot.user.setActivity("MAINTENANCE MODE");
	}
	else {
		NOTIFICATION_CHANNEL = notification_backup;
		testing.send("Testing mode disabled.");
		bot.user.setActivity("Analiza");
	}
}

urnik = {};
function get_urnik() {
	let url = URNIK_API_URL;
	fetch(url, { method: "GET" })
		.then(res => res.json())
		.then((json) => {
			console.log("Got urnik. Lecture count: "+json.length);
			urnik = [];
			for (u in json) {
				if (!(json[u].dan in urnik)) urnik[json[u].dan] = [];
				urnik[json[u].dan].push(json[u]);
			}
			console.log("Day count: "+urnik.length);
			for (dan in urnik) {
				urnik_unique = {};
				lectures = getUniqueLectures(urnik[dan]);
				for (i in lectures) {
					// grab all occurrences a lecture
					lect = urnik[dan].filter((ura)=>{return ura.predmet.abbr+"-"+ura.tip == lectures[i]});
					// clone the first occurrence, then we will replace
					// the ura field with an array of times and professors
					urnik_unique[lectures[i]] = {...lect[0]};
					delete urnik_unique[lectures[i]].profesor;
					urnik_unique[lectures[i]].ura = []; // ura is now array of occurrences
					// assemble array of occurrences
					for (l in lect) {
						time = lect[l].ura;
						prof = lect[l].profesor;
						urnik_unique[lectures[i]].ura.push(time+":15 ("+prof+")");
						// example data structure:
						// ura: [ '8:15 (Nikolaj Zimic)', '10:15 (Nikolaj Zimic)' ],
					}
					// sort occurrences by time
					urnik_unique[lectures[i]].ura.sort((a,b)=>{
						aa=parseInt(a.split(":")[0]); // only the hour should vary anyway
						bb=parseInt(b.split(":")[0]);
						if (aa < bb) return -1;
						if (aa > bb) return 1;
						return 0;
					});
				}
				urnik[dan] = urnik_unique;
			}
			//console.log("urnik after uniquisation:");
			//console.log(urnik);
		});
}


function warn(txt) {
	const channel = bot.channels.get(TESTING_CHANNEL);
	channel.send(txt)
		.catch((e)=>{console.log(e)})
}

bot.on("message", function(message) {
	// DEBUG:
	// if the message is from me and starts with %, eval() the message
	// and send the output back to the same channel
	if (message.author.id === ADMIN_ID && message.content.indexOf("%") === 0) {
		try {
			// if the message is in ```code blocks```, supress the return value
			if (message.content.indexOf("```") != 1) {
				message.channel.send("```"+eval(message.content.substring(1))+"```")
					.catch((e)=>{console.log(e)})
			}
			else {
				// log the return value to the console instead
				console.log(eval(message.content.slice(4,-3)));
			}
			return;
		}
		catch(e) {
			message.channel.send("```"+e+"```")
				.catch((e)=>{console.log(e)})
			return;
		}
	}

	// @Uros ping
	if (message.guild !== null && message.isMentioned(bot.user)) {
		message.react("🥳")
			.catch((e)=>{console.log(e)})
		message.channel.send("I heard my name!")
			.catch((e)=>{console.log(e)})

		if (Math.floor(Math.random() * 100) == 0)
			// super rare event!
			message.author.send("yuo are sexy");

		return;
	}
});

bot.on('ready', function() {
	console.log('Uroš ready!'); // bot initialization complete
	bot.user.setActivity("Analiza"); // TODO: set to whatever is currently going on
});

console.log("Uroš is waking up ...");
bot.login(process.env["CLIENT_SECRET"]).then(() => {
	console.log("Logged in alright"); // didn't crash (yet)
});

urnik = get_urnik();


const dailyScheduleJob = new CronJob.CronJob (
	'00 7 * * *', // “At 07:00 every day” https://crontab.guru/
	()=>{
		if (getToday() < 5) { // is weekday (days 0 1 2 3 4)
			dailySchedule();
			dailyMentions();
			dailyDeadlines();
		}
		else {
			dailyMentions();
			dailyDeadlines();
		}
	},
	null, // oncomplete
	true, // start flag (start the job immediately)
	"Europe/Ljubljana" // thank you momentjs I owe you my life
);

// get 0-based day of the week index
function getToday() {
	return (moment().day()+6) % 7; // 0 should be Monday, not Sunday
}

function dailySchedule() {
	const channel = bot.channels.get(NOTIFICATION_CHANNEL);
	let today = getToday();

	if (!(today in urnik)) return; // nothing today
	if (urnik[today].length == 0) return; // today exists, but is empty

	message = "Dobro jutro! Tu je današnji urnik:";
	for (u in urnik[today]) {
		isVaje = (urnik[today][u].tip.indexOf("V") != -1);
		type = isVaje? "vaje" : "predavanja";
		message += "\n\n";
		message += ":"+(urnik[today][u].predmet.color || "white")+"_"+(isVaje?"circle":"square")+": ";
		message += "**"+urnik[today][u].predmet.name+" - "+type+"** ob ";
		message += urnik[today][u].ura.join(", ");
		message += "\n";
		if (!urnik[today][u].link)
			message += "Ni linka :(";
		else if (urnik[today][u].link.indexOf("http") == 0)
			message += "<"+urnik[today][u].link+">"; // disable link preview
		else
			message += urnik[today][u].link;
	}
	channel.send(message)
		.catch((e)=>{console.log(e)});

	return "Daily schedule sent to "+NOTIFICATION_CHANNEL;
}

function dailyMentions() {
	// TODO: "today was mentioned in the following posts:"
	return "Fetching mentions now. This might take a minute ...";
}

function dailyDeadlines() {
	// ":alarm: Ne pozabi! Danes je rok za (quiz/assignment)!"
	fetch(MOODLE_API_URL+"/getQuizzes?location=fri&deadlines=true", { method: "GET" })
	.then(res => res.json())
	.then((fri_quizzes) => {
		fetch(MOODLE_API_URL+"/getQuizzes?location=fmf&deadlines=true", { method: "GET" })
		.then(res => res.json())
		.then((fmf_quizzes) => {
			fetch(MOODLE_API_URL+"/getAssignments?location=fri&deadlines=true", { method: "GET" })
			.then(res => res.json())
			.then((fri_assignments) => {
				fetch(MOODLE_API_URL+"/getAssignments?location=fmf&deadlines=true", { method: "GET" })
				.then(res => res.json())
				.then((fmf_assignments) => {
					console.log("Got FRI quiz deadlines:");
					console.log(fri_quizzes);
					console.log("Got FMF quiz deadlines:");
					console.log(fmf_quizzes);
					console.log("Got FRI ass deadlines:");
					console.log(fri_assignments);
					console.log("Got FMF ass deadlines:");
					console.log(fmf_assignments);

					var message = {
						color: 0xFF0000,
						title: '🚨 POZOR! 🚨',
						description: 'Danes je rok za oddajo:',
						fields: [
							// example data structure:
							//{
								//name: 'LINALG',
								//value: '1. DN Naloga',
							//},
						],
						timestamp: new Date(),
						footer: {
							text: 'Za vaše ocene poskrbi Uroš',
							icon_url: AVATAR_URL,
						},
					};

					var quizzes = Object.assign(fri_quizzes, fmf_quizzes);
					var assignments = Object.assign(fri_assignments, fmf_assignments);
					for (abbr in quizzes) {
						for (dline in quizzes[abbr]) {
							if (!quizzes[abbr][dline].timestamps) continue;
							if (isTimestampToday(quizzes[abbr][dline].timestamps.close)) {
								message.fields.push({
										"name": "➡️ "+abbr,
										"value": quizzes[abbr][dline].title
								});
								console.log("DEADINE TODAY: ["+abbr+"] "+quizzes[abbr][dline].title);
							}
						}
					}
					for (abbr in assignments) {
						for (dline in assignments[abbr]) {
							if (!assignments[abbr][dline].timestamps) continue;
							if (isTimestampToday(assignments[abbr][dline].timestamps.due)) {
								message.fields.push({
										"name": "➡️ "+abbr,
										"value": assignments[abbr][dline].title
								});
								console.log("DEADINE TODAY: ["+abbr+"] "+assignments[abbr][dline].title);
							}
						}
					}

					if (message.fields.length > 0) {
						const channel = bot.channels.get(NOTIFICATION_CHANNEL);
						channel.send({ embed: message })
							.catch((e)=>{console.log(e)});
					}
					else {
						console.log("No deadlines today. Lp");
					}
				});
			});
		});
	});
	return "Fetching deadlines now. This might take a minute ...";
}

function isTimestampToday(time) {
	if (!time) return false; // might happen when checking quizzes without deadlines
	return moment(time*1000).tz("Europe/Ljubljana").isSame(moment(), 'day');
}

function getUniqueLectures(urnik) {
	lectures = [];
	for (i in urnik) {
		if (!(urnik[i].predmet.abbr in lectures)) {
			lectures.push(urnik[i].predmet.abbr+"-"+urnik[i].tip);
		}
	}
	return lectures;
}
