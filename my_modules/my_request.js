
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			host: req.headers.host
		}, function(err, item){
			if(item){
				res.render('configure_change', item);
			}else{
				res.render('configure');
			}
		});
	});
	
	app.post('/configure', function(req, res){
		var data = req.body;
		console.log(data);
		/*var configureData = {
				app_name : data.app_name,
				host: req.headers.host,
				salesforce_app: {
					consumer_key: data.consumer_key,
					consumer_secret: data.consumer_secret,
					username: data.username,
					password: data.password
				},
				facebook_app:{
					app_name: data.app_name,
					app_id: data.app_id,
					app_secret: data.app_secret,
					webhook_validation_token: data.webhook_validation_token,
					page_name: data.page_name,
					page_access_token: data.page_access_token
				}
			}*/
		
	});
}