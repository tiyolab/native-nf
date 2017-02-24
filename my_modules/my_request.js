
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			app_name: req.headers.host
		}, function(err, item){
			if(item){
				console.log(item);
				res.render('configure');
			}else{
				res.render('configure');
			}
		});
	});
	
}