var 
	app_name, 
	host, 
	sf_consumer_key, 
	sf_consumer_secret, 
	sf_username, 
	sf_password,
	fb_app_name,
	fb_app_id,
	fb_app_secret,
	fb_webhook_validation_token,
	fb_page_name,
	fb_page_access_token;
	
exports.configure = (db) => {
	var collection = db.collection('app_configuration');
	collection.findOne({
		host: req.headers.host
	}, function(err, item){
		if(err){
			console.log('ERR: cannot load configuration');
			return;
		}else{
			if(item){
				app_name 					= item.app_name;
				host 						= item.host;
				sf_consumer_key 			= item.salesforce_app.sf_consumer_key;
				sf_consumer_secret 			= item.salesforce_app.sf_consumer_secret;
				sf_username 				= item.salesforce_app.sf_username; 
				sf_password 				= item.salesforce_app.sf_password;
				fb_app_name 				= item.facebook_app.fb_app_name;
				fb_app_id 					= item.facebook_app.fb_app_id;
				fb_app_secret 				= item.facebook_app.fb_app_secret;
				fb_webhook_validation_token = item.facebook_app.fb_webhook_validation_token;
				fb_page_name	 			= item.facebook_app.fb_page_name;
				fb_page_access_token 		= item.facebook_app.fb_page_access_token;
			}else{
				console.log('ERR: configuration not exists, configure by access /configure');
				return;
			}
		}
	});
}

exports.APP_NAME = app_name;
exports.SERVER_URL = 'https://' + host + '/';
exports.SF_CONSUMER_KEY = sf_consumer_key;
exports.SF_CONSUMER_SECRET = sf_consumer_secret;
exports.SF_CONSUMER_USERNAME = sf_username;
exports.SF_CONSUMER_PASSWORD = sf_password;
exports.FB_APP_NAME = fb_app_name;
exports.FB_APP_ID = fb_app_id;
exports.FB_APP_SECRET = fb_app_secret;
exports.FB_WEBHOOK_VALIDATION_TOKEN = fb_webhook_validation_token;
exports.FB_PAGE_NAME = fb_page_name;
exports.FB_PAGE_ACCESS_TOKEN = fb_page_access_token;