
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		var configuration = collection.findOne({
			app_name: req.header.host
		}, function(err, item){
			console.log('result');
			console.log(item);
		});
		console.log(req.header.host);
		console.log(configuration);
		res.render('configure');
	});
	
}