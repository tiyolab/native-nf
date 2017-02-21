/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

var mySession = [];

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');

var oauth;
var nforce = require('nforce');
var fs = require('fs');
var app = express();
var cookieParser = require('cookie-parser');
var session = require('express-session');
var MongoDBStore = require('connect-mongodb-session')(session);
var mongoSessionStore = new MongoDBStore({
	uri: 'mongodb://mortgage-testv1.herokuapp:mortgage12345@ds145369.mlab.com:45369/mortgage-testv1-mongodb',
	collection: 'session'
});

//catch session stored
mongoSessionStore.on('error', function(error){
	console.log(error);
});

app.set('port', process.env.PORT || 1107);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(express.static('public'));

app.use(cookieParser());
app.use(session({
	secret: 'd5e79d3c37be21dbe96afca771582b94',
	cookie: {
		maxAge: 1000 * 60 * 60 * 24 * 7
	},
	store: mongoSessionStore,
	resave: false,
	saveUninitialized: false
}));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

console.log('tiyo said server running');

// use the nforce package to create a connection to salesforce.com
var org = nforce.createConnection({
  clientId: '3MVG9YDQS5WtC11rPPnDcisY1IxDsekPGj0vXsxGSP4BGRKf28MxnXp2vFuwfYql8y0wB7TwnkLdwBk0W6N4q',
  clientSecret: '2874640950902301743',
  redirectUri: 'http://localhost:' + app.get('port') + '/oauth/_callback',
  apiVersion: 'v27.0',  // optional, defaults to current salesforce API version 
  environment: 'production',  // optional, salesforce 'sandbox' or 'production', production default 
  mode: 'single', // optional, 'single' or 'multi' user mode, multi default'
  username: 'apiai@api.ai',
  password: 'Jakarta12345'
});

org.authenticate({ username: org.username, password: org.password}, function(err, resp){
  // the oauth object was stored in the connection object
  if(!err) console.log('Cached Token: ' + org.oauth.access_token)
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var alt = req.query.account_linking_token;
  var senderID = req.query.sid;
  
  res.render('authorize', {
    alt: alt,
	senderID: senderID
  });
});

/**
 * oauth to facebook 
 */

var FB_REDIRECT_URI = 'fboauth3';
var FB_APP_ID = '720602331440012';
var FB_APP_SECRET = 'd5e79d3c37be21dbe96afca771582b94';

/**
 * create user or login from chatbot
 */
app.get('/ssoauth', function(req, res){
	var senderID = req.query.senderid;
	var requestUri = 'https://www.facebook.com/v2.8/dialog/oauth?client_id='+ FB_APP_ID +'&display=popup&response_type=code%20token&redirect_uri='+SERVER_URL+'/'+FB_REDIRECT_URI+'?senderid='+senderID;
	sendTextMessage(req.query.senderid, 'Please wait until we finish authenticate you:-)');
	res.redirect(requestUri);
});

/**
 * bridge ouath facebook response
 */
app.get('/'+FB_REDIRECT_URI, function(req, res){
	res.render('bridgeuri', {
		senderID: req.query.senderid
	});
});

/**
 * handling ouath facebook response from bridge
 */
 app.get('/fboauthhandler', function(req, res){
	//confirm identity
	var uri = 'https://graph.facebook.com/debug_token?input_token='+ req.query.access_token +'&access_token='+ FB_APP_ID + '|' + FB_APP_SECRET;
	request(uri, function(err, resp, body){
		if (!err && resp.statusCode == 200) {
			body = JSON.parse(body);
			var senderId = req.query.senderid;
			var FBUserId = body.data.user_id;
			
			org.query({query: "select Id, ContactId, AccountId from User where Fb_Id__c = '" + FBUserId + "'"}, function(errQ, respQ){
				if(errQ){
					console.log(errQ);
					sendTextMessage(req.query.senderid, 'we failed to authenticate you');
				}else{
					if(respQ.records.length > 0){
						respQ.records.forEach(function(data){
							mySession[senderId] = {
								fb_user_id: FBUserId,
								s_user_id: data.get('Id'),
								s_account_id: data.get('AccountId'),
								s_contact_id: data.get('ContactId'),
								state: ''
							}
						});
						console.log(mySession);
						sendTextMessage(req.query.senderid, 'Successfully authenticated you.');
					}else{
						joinMessage(senderId);
					}
				}
				
				res.render('fboauthhandler');
			});
		}else{
			console.error("Failed login to fb", resp.statusCode, resp.statusMessage, body.error);
			sendTextMessage(req.query.senderid, 'we failed to authenticate you');
			res.render('fboauthhandler');
		}
	});
 });

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
	console.log("tiyo said state in get");
	console.log(req.query['hub.verify_token']);
	console.log(VALIDATION_TOKEN);
	
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/auth', function(req, res){
	var data = req.body;
	org.query({query : "select Id, Name, BillingStreet, Website, Phone from Account limit 10"}, function(errQuery, respQuery){
				console.log(errQuery);
				console.log(respQuery.records);
			});
	res.sendStatus(200);
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
	console.log("tiyo said state in post");
	var data = req.body;
	
	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function(pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function(messagingEvent) {
				if (messagingEvent.message) {
					receivedMessage(messagingEvent, req);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		//
		// You must send back a 200, within 20 seconds, to let us know you've 
		// successfully received the callback. Otherwise, the request will time out.
		res.sendStatus(200);
	}
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}


/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event, req) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
	var msgState = [];
	if(mySession[senderID]){
		msgState = mySession[senderID]['state'].split('/');
	}
	
	console.log(mySession[senderID]['state']);
	
	if(msgState.length > 0){
		if(msgState[0] == 'open_case'){
			if(msgState[1] == 'subject'){
				mySession[senderID]['data']['subject'] = messageText;
				mySession[senderID]['state'] = 'open_case/description';
				
				sendTextMessage(senderID, 'Description');
			}else if(msgState[1] == 'description'){
				mySession[senderID]['data']['description'] = messageText;
				
				var nCase = nforce.createSObject('Case');
				nCase.set('OwnerId', '' + mySession[senderID].s_user_id);
				nCase.set('AccountId', '' + mySession[senderID].s_account_id);
				nCase.set('ContactId', '' + mySession[senderID].s_contact_id);
				nCase.set('Status', 'New');
				nCase.set('Origin', 'Web');
				nCase.set('Subject', mySession[senderID]['data']['subject']);
				nCase.set('Description', mySession[senderID]['data']['description']);
				
				org.insert({sobject: nCase}, function(err, res){
					if(!err){
						sendTextMessage(senderID, 'Successfully open new case.');
					}else{
						console.log(err);
						sendTextMessage(senderID, 'Failed open new case.');
					}
					mySession[senderID]['state'] = '';
				});
			}
		}
	}else{
		if(messageText.search(/broker/i) > -1){
			sendShowBrokerMessage(senderID);
		}else if(messageText.search(/hei/i) > -1 || messageText.search(/hi/i) > -1){
			sendTextMessage(senderID, 'Hi');
		}else if(messageText.search(/help/i) > -1){
			sendTextMessage(senderID, '1. "Show Broker" to show all our brokers in the area.'+
			'\n2. "Open Case" to open new case.'+
			'\n3. "Open Community" to open Community.'+
			'\n4. "Cancel Community" to leave from community.');
		}else if(messageText.search(/open case/i) > -1){
			if(mySession[senderID]){
				mySession[senderID]['state'] = 'open_case/subject';
				console.log(mySession[senderID]);
				sendTextMessage(senderID, 'Subject');
			}else{
				authMessage(senderID);
			}
		}else if(messageText.search(/cancel community/i) > -1){
			if(mySession[senderID]){
				sendTextMessage(senderID, "Please wait. we'll process your request.");
				processCancelCommunity(mySession[senderID].s_user_id, senderID);
			}else{
				sendTextMessage(senderID, "You're not our community member yet.");
			}
		}else if(messageText.search(/open community/i) > -1){
			openCommunity(senderID);
		}else{
			sendTextMessage(senderID, messageText);
		}
	}
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
	console.log('sender id adalah '+recipientId);
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function authMessage(recipientId) {
	var messageData = {
		recipient: {
		  id: recipientId
		},
		message:{
		  attachment: {
			type: "template",
			payload: {
			  template_type: "generic",
			  elements: [
				{
					title: "We need to synchronize first, please click button below.",
				  image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
				  buttons: [
					{
						type: "account_link",
						url: SERVER_URL + "/ssoauth?senderid="+recipientId,
					}
					/*{
						type: "web_url",
						url: SERVER_URL + "/ssoauth?senderid="+recipientId,
						title:"Join"
					}*/
				  ]
				}
			  ]
			}
		  }
		}
	}

  callSendAPI(messageData);
}

function joinMessage(recipientId) {
	var messageData = {
		recipient: {
		  id: recipientId
		},
		message:{
		  attachment: {
			type: "template",
			payload: {
			  template_type: "generic",
			  elements: [
				{
					title: "it seem you are not our community member. feel free to join us by click button below.",
				  image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
				  buttons: [
					{
						type: "web_url",
						url: 'https://apiai-community-developer-edition.ap4.force.com/mortgagetestv1',
						title:"Join"
					}
				  ]
				}
			  ]
			}
		  }
		}
	}

  callSendAPI(messageData);
}


function openCommunity(recipientId) {
	var messageData = {
		recipient: {
		  id: recipientId
		},
		message:{
		  attachment: {
			type: "template",
			payload: {
			  template_type: "generic",
			  elements: [
				{
					title: "Click button bellow to open community",
				  image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
				  buttons: [
					{
						type: "web_url",
						url: 'https://apiai-community-developer-edition.ap4.force.com/mortgagetestv1',
						title:"Open"
					}
				  ]
				}
			  ]
			}
		  }
		}
	}

  callSendAPI(messageData);
}

/*
 * show broker list
 */
function sendShowBrokerMessage(recipientId){
	org.query({query : "select Id, Name, BillingStreet, Website, Phone from Account limit 10"}, function(errQuery, respQuery){
		if(errQuery){
			console.log(errQuery);
		}else{
			var elementsAccount = [];
			respQuery.records.forEach(function(ac){
				var phone = '';
                if(ac.get('Phone')){
                    phone = ac.get('Phone');
                }
                
                
                var street = '';
                if(ac.get('BillingStreet')){
                	street = ac.get('BillingStreet');
                }
                elementsAccount.push(
					{
					  title: ac.get('Name'),
					  subtitle: "Address: "+ street.replace('\n', ' ').replace('\r',' ') +" Website: "+ ac.get('Website'),
					  buttons: [
						{
						  type: "phone_number",
						  title: "Call",
						  payload: phone
						},
						{
						  type: "postback",
						  title: "Refer Me",
						  payload: "test"
						}
					  ]
					}
				);
			});
			
			console.log(elementsAccount);
			
			var messageData = {
				recipient: {
				  id: recipientId
				},
				message:{
				  attachment: {
					type: "template",
					payload: {
					  template_type: "generic",
					  elements: elementsAccount
					}
				  }
				}
			}
			callSendAPI(messageData);
		}
	});
}

/**
 * Process cancel community
 */
function processCancelCommunity(sUserId, senderId){
	request({
		method	: 'POST',
		url		: 'https://tiyolab-developer-edition.ap4.force.com/services/apexrest/mortgagetestv1',
		json	: {
			action: 'cancelcommunity',
			userid: sUserId
		}
	}, function(err, res, body){
		if (!err && res.statusCode == 200) {
			if(body.status){
				delete mySession[senderId];
				sendTextMessage(senderId, "Success leaving community.");
			}else{
				sendTextMessage(senderId, "Failed to leave community.");
			}
		}else{
			console.error("failed to exit community", res.statusCode, res.statusMessage, body.error);
			sendTextMessage(senderId, "Failed to leave community.");
		}
	});
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
		  console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

