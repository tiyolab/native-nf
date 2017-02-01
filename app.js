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
var RedisStore = require('connect-redis')(session);

app.set('port', process.env.PORT || 1107);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(express.static('public'));

app.use(cookieParser());
app.use(session({
	/*store: new RedisStore({
		host: 'https://mortgage-testv1.herokuapp.com/',
		port: app.get('port'),
		db: 2
	}),*/
	secret: 'd5e79d3c37be21dbe96afca771582b94'
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
  mode: 'multi' // optional, 'single' or 'multi' user mode, multi default 
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
	
	org.authenticate({ username: data.username, password: data.password }, function(err, resp){
		if(err) {
			console.log('Error: ' + err.message);
			sendTextMessage(data.sid, 'Login failed. ' + err.message);
		} else {
			console.log('login success')
			console.log('Access Token: ' + resp.access_token);
			//oauth = resp;
			mySession[data.sid] = resp;
			sendTextMessage(data.sid, 'Login success, you can perform your last action');
		}
	});
	res.sendStatus(200);
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var redirectURI = req.query.redirect_uri;
  var senderID = req.query.sid;
  
  res.render('authorize', {
    redirectURI: redirectURI,
	senderID: senderID
  });
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
					receivedMessage(messagingEvent);
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
function receivedMessage(event) {
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
	if(messageText.search(/broker/i) > -1){
		if(mySession[senderID]){
			sendShowBrokerMessage(senderID);
		}else{
			loginMessage(senderID);
		}
	}else{
		sendTextMessage(senderID, messageText);
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
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: 'response from native bot = ' + messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}


/*
 * Send a message with the account linking call-to-action in order need login
 *
 */
function loginMessage(recipientId) {
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
					title: "Login",
				  image_url: "https://raw.githubusercontent.com/tiyolab/bb-event/master/mortgage-central.jpg",
				  buttons: [
					{
						type: "account_link",
						url: SERVER_URL + "/authorize?sid="+recipientId
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
	org.query({query : "select Id, Name, BillingStreet, Website, Phone from Account limit 10", oauth : mySession[recipientId]}, function(errQuery, respQuery){
		if(errQuery){
			console.log(errQuery);
		}else{
			var elementsAccount = [];
			respQuery.records.forEach(function(ac){
				var phone = '';
                if(ac.Phone){
                    phone = ac.Phone;
                }
                
                
                var street = '';
                if(ac.BillingStreet){
                	street = BillingStreet;
                }
                elementsAccount.push('{"title":"'+ ac.Name +'","subtitle":"Address: '+ street.replace('\n', '').replace('\r','') +'Website: '+ ac.Website +'","buttons":[{"type":"phone_number","phone_number":"'+ phone +'","title":"Call"}, {"type":"show_block","block_name":"Create lead","title":"Refer Me", "set_attributes":{"account_id":"'+ ac.Id +'"}}]}');
			});
			//var strElement = '{"messages":[{"attachment":{"type":"template","payload":{"template_type":"generic","elements":['+ String.join(elements, ',') +']}}}]}';
			
			console.log(JSON.parse(elementsAccount.join(',')));
			
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
						JSON.parse(elementsAccount.join(','))
					  ]
					}
				  }
				}
			}
			callSendAPI(messageData);
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

