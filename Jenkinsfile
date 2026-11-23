pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'YOUR_DOCKERHUB_USERNAME/attendance-app'
        DOCKER_TAG = "${BUILD_NUMBER}"

        CONTAINER_NAME = 'attendance-app'
        APP_PORT = '3000'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    if [ -f backend/package-lock.json ]; then
                        cd backend
                        npm ci
                    elif [ -f package-lock.json ]; then
                        npm ci
                    else
                        echo "No package-lock.json found"
                        exit 1
                    fi
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                    cd backend

                    if node -e "
                      const p = require('./package.json');
                      process.exit(p.scripts && p.scripts.test ? 0 : 1);
                    "; then
                        npm test
                    else
                        echo "No test script configured; skipping tests"
                    fi
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                      -t ${DOCKER_IMAGE}:${DOCKER_TAG} \
                      -t ${DOCKER_IMAGE}:latest \
                      .
                '''
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-credentials',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )
                ]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login \
                          -u "$DOCKER_USER" --password-stdin

                        docker push ${DOCKER_IMAGE}:${DOCKER_TAG}
                        docker push ${DOCKER_IMAGE}:latest

                        docker logout
                    '''
                }
            }
        }

        stage('Deploy') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'attendance-mongodb-uri',
                        variable: 'MONGODB_URI'
                    )
                ]) {
                    sh '''
                        docker rm -f ${CONTAINER_NAME} || true

                        docker run -d \
                          --name ${CONTAINER_NAME} \
                          --restart unless-stopped \
                          -p ${APP_PORT}:3000 \
                          -e NODE_ENV=production \
                          -e PORT=3000 \
                          -e MONGODB_URI="$MONGODB_URI" \
                          ${DOCKER_IMAGE}:${DOCKER_TAG}
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Attendance application deployed successfully!'
        }

        failure {
            echo 'Pipeline failed. Check Jenkins console output.'
        }

        always {
            echo 'Jenkins pipeline execution completed.'
        }
    }
}
