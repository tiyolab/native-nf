const os = require('os');
const _package = require('../package.json');
const myFunctional = require('./my_functional');
const nforce = require('nforce');
const request = require('request');
var org = {};

exports.handleConfigure = (app, db) => {
	console.log();
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			my_app_name: _package.name
		}, function(err, item){
			if(item){
				item['status'] = -1;
				res.render('configure_change', item);
			}else{
				res.render('configure');
			}
		});
	});
	
	app.post('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		var data = req.body;
		
		data['host'] = 'https://' + req.headers.host + '/';
		data['my_app_name'] = _package.name;
		
		if(data.status_record === 'new'){
			collection.insert(data, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else{
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}else if(data.status_record === 'old'){
			collection.update({my_app_name: _package.name}, {$set: data}, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else {
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}
		
		GLOBAL_CONFIG = data;
		exports.handleRequest(app, db);
		//xxx
	});
}

exports.handleRequest = (app, db) => {
	/**
	 * create salesforce connection
	 */
	org = nforce.createConnection({
		clientId: GLOBAL_CONFIG.salesforce_app.consumer_key,
		clientSecret: GLOBAL_CONFIG.salesforce_app.consumer_secret,
		redirectUri: 'http://localhost:' + app.get('port') + '/oauth/_callback',
		apiVersion: 'v27.0',  // optional, defaults to current salesforce API version 
		environment: 'production',  // optional, salesforce 'sandbox' or 'production', production default 
		mode: 'single', // optional, 'single' or 'multi' user mode, multi default'
		username: GLOBAL_CONFIG.salesforce_app.username,
		password: GLOBAL_CONFIG.salesforce_app.password
	});
	
	/**
	 * create salesforce authentication
	 */
	org.authenticate({ username: org.username, password: org.password}, function(err, resp){
		// the oauth object was stored in the connection object
		if(err){
			console.error('Error connect to salesforce: ');
			console.error(err);
		}else{
			console.log('salesforce auth success');
			console.log(org);
		}
	});
	
	
	/**
	 * create facebook oauth
	 */
	var FB_REDIRECT_URI = 'fboauth3';
	app.get('/ssoauth', function(req, res){
		var senderID = req.query.senderid;
		var requestUri = 'https://www.facebook.com/v2.8/dialog/oauth?client_id='+ GLOBAL_CONFIG.facebook_app.app_id +'&display=popup&response_type=code%20token&redirect_uri='+ GLOBAL_CONFIG.host +'/'+FB_REDIRECT_URI+'?senderid='+senderID;
		myFunctional.sendTextMessage(req.query.senderid, 'Please wait until we finish authenticate you:-)');
		res.redirect(requestUri);
	});
	
	
	/**
	 * bridge ouath facebook response
	 * this due to remove '#' from url
	 */
	app.get('/'+FB_REDIRECT_URI, function(req, res){
		res.render('bridgeuri', {
			senderID: req.query.senderid
		});
	});
	
	
	/**
	 * handling ouath facebook response from bridge
	 * get information such us FB user Id and salesforce related user information (user id, account id, contanct id)
	 */
	app.get('/fboauthhandler', function(req, res){
		var uri = 'https://graph.facebook.com/debug_token?input_token='+ req.query.access_token +'&access_token='+ GLOBAL_CONFIG.facebook_app.app_id + '|' + GLOBAL_CONFIG.facebook_app.app_secret;
		request(uri, function(err, resp, body){
			if (!err && resp.statusCode == 200) {
				body = JSON.parse(body);
				var senderId = req.query.senderid;
				var FBUserId = body.data.user_id;
				
				org.query({query: "select Id, ContactId, AccountId from User where Fb_Id__c = '" + FBUserId + "'"}, function(errQ, respQ){
					if(errQ){
						console.log(errQ);
						myFunctional.sendTextMessage(req.query.senderid, 'we failed to authenticate you');
					}else{
						if(respQ.records.length > 0){
							respQ.records.forEach(function(data){
								MY_SESSION[senderId] = {
									fb_user_id: FBUserId,
									s_user_id: data.get('Id'),
									s_account_id: data.get('AccountId'),
									s_contact_id: data.get('ContactId'),
									state: '',
									data: {}
								}
							});
							myFunctional.sendTextMessage(req.query.senderid, 'Successfully authenticated you.');
						}else{
							myFunctional.joinMessage(senderId);
						}
					}
					
					res.render('fboauthhandler');
				});
			}else{
				console.error("Failed login to fb", resp.statusCode, resp.statusMessage, body.error);
				myFunctional.sendTextMessage(req.query.senderid, 'we failed to authenticate you');
				res.render('fboauthhandler');
			}
		});
	 });
	 
	
	/**
	 * Use your own validation token. Check that the token used in the Webhook 
	 * setup is the same token used here.
	 *
	 */
	app.get('/webhook', function(req, res) {
		if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === GLOBAL_CONFIG.facebook_app.webhook_validation_token) {
			console.log("Validating webhook");
			res.status(200).send(req.query['hub.challenge']);
		} else {
			console.error("Failed validation. Make sure the validation tokens match.");
			res.sendStatus(403);          
		}  
	});
	
	
	/**
	 * All callbacks for Messenger are POST-ed. They will be sent to the same
	 * webhook. Be sure to subscribe your app to your page to receive callbacks
	 * for your page. 
	 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
	 *
	 */
	app.post('/webhook', function (req, res) {
		
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
						myFunctional.receivedMessage(org, messagingEvent, req);
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
	
	
	/**
	 * configure response
	 */
	app.get('/response_configuration', function(req, res){
		var collection = db.collection('response_configuration');
		collection.findOne({},function(err, data){
			if(data){
				console.log('data');
				console.log(data.item);
			
				res.render('response_configuration', {
					configuration: data.item,
					error_message: ''
				});
			}else{
				res.render('response_configuration', {
					configuration:[],
					error_message: 'failed load configuration'
				});
			}
		});
	});
	
	
	app.post('/response_configuration', function(req, res){
		//res.json(req.body);
		//return;
		//strip empty data
		var tmpBody = [];
		var tmpArray = [];
		var tmpResponseButton = [];
		
		tmpBody = req.body.item.filter(function(o1){
			
			/**
			 * validate request
			 */
			tmpArray = o1.requests.filter(function(request){
				return request != '';
			});
			o1.requests = tmpArray;
			if(o1.requests.length == 0){
				return false;
			}
			
			/**
			 * validate response
			 */
			tmpArray = o1.responses.filter(function(response){
				if(response.type == ''){
					return false;
				}else if(response.type == 'text'){
					return response.payload != '';
				}else if(response.type == 'button_template' || response.type == 'generic_template'){
					tmpResponseButton = response.payload.buttons.filter(function(btn){
						if(btn.type == ''){
							return false;
						}
						
						if(btn.type == 'web_url'){
							if(btn.title == '' || btn.url == ''){
								return false;
							}
						}
						
						return true;
					});
					response.payload.buttons = tmpResponseButton;
					
					if(response.type == 'generic_template'){
						if(response.payload.title == ''){
							return false;
						}
					}					
					
					if(response.type == 'button_template'){
						if(response.payload.text == ''){
							return false;
						}
						
						if(response.payload.buttons.length == 0){
							return false;
						}
					}
					
					return true;
				}else if(response.type == 'salesforce_query'){
					//object required
					if(response.payload.query.sobject == ''){
						return false;
					}
					
					//field required
					var tmpFields = [];
					console.log('field');
					console.log(response.payload.query.fields);
					tmpFields = response.payload.query.fields.filter(function(field){
						return field != '';
					});
					response.payload.query.fields = tmpFields;
					
					if(response.payload.query.fields.length == 0){
						return false;
					}
					
					//where optional
					var tmpWhere = [];
					tmpWhere = response.payload.query.where.filter(function(where){
						if(where.source == '' || where.operator == '' || where.destination == ''){
							return false;
						}
						return true;
					});
					response.payload.query.where = tmpWhere;
					
					//title mandatory
					if(response.payload.title == ''){
						return false;
					}
					
					//button optional
					tmpResponseButton = response.payload.buttons.filter(function(btn){
						if(btn.type == ''){
							return false;
						}
						
						if(btn.type == 'web_url'){
							if(btn.title == '' || btn.url == ''){
								return false;
							}
						}
						
						return true;
					});
					response.payload.buttons = tmpResponseButton;
					
					return true;
				}
				
				return true;
			});
			o1.responses = tmpArray;
			
			return true;
		});
		
		req.body.item = tmpBody;
		
		var collection = db.collection('response_configuration');
		collection.remove({}, function(err, result){
			if(!err){
				collection.insert(req.body, {w:1}, function(errInsert, resultInsert){
					if(errInsert){
						res.render('response_configuration', {
							configuration: req.body.item,
							error_message: 'failed save configuration'
						});
					}else{
						BOT_CONFIGURATION = req.body.item;
						res.render('response_configuration', {
							configuration:req.body.item,
							error_message: ''
						});
					}
				});
			}
		});
	});
	
	app.get('/s_objects', function(req, res){
		request({
			url: org.oauth.instance_url + '/services/data/v20.0/sobjects',
			method: 'GET',
			json: true,
			headers: {
				'Authorization': org.oauth.token_type + ' ' + org.oauth.access_token
			}
		}, function(error, response, body){
			var sObjects = [];
			if(!error && response.statusCode == 200){
				body.sobjects.forEach(function(sobject){
					sObjects.push({
						name: sobject.name
					});
				});
			}
			
			res.json(sObjects);
		});
	});
	
	app.get('/s_object_field', function(req, res){
		var object = req.query.o;
		
		request({
			url: org.oauth.instance_url + '/services/data/v20.0/sobjects/'+object+'/describe',
			method: 'GET',
			json: true,
			headers: {
				'Authorization': org.oauth.token_type + ' ' + org.oauth.access_token
			}
		}, function(error, response, body){
			var fields = [];
			if(!error && response.statusCode == 200){
				body.fields.forEach(function(field){
					fields.push({
						name: field.name
					});
				});
			}
			
			res.json(fields);
		});
	});
};