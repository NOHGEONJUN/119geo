// A. 전역 변수 설정
const initialCoords = [37.5665, 126.9780];
const initialZoom = 13;

const map = L.map('map').setView(initialCoords, initialZoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// 내비게이션 상태 변수
let startPoint = null;
let endPoint = null;
let startMarker = null;
let endMarker = null;
let routeLayer = null;
let userMarker = null; // 실시간 위치 마커
let watchId = null;     // GPS 추적 ID

// 턴-바이-턴 및 내비게이션 변수
let routeSteps = []; // OSRM steps 배열
let currentStepIndex = 0; // 현재 step 인덱스
let previousPosition = null; // 이전 GPS 위치 (헤딩 계산용)
let isNavigating = false; // 내비게이션 모드 여부
let routeGeometry = null; // 경로 geometry (이탈 감지용)
let rerouteCheckInterval = null; // 재탐색 체크 인터벌


// B. 지도 초기화 및 마커/경로 제거
function resetMap() {
    if (startMarker) map.removeLayer(startMarker); startMarker = null;
    if (endMarker) map.removeLayer(endMarker); endMarker = null;
    if (routeLayer) map.removeLayer(routeLayer); routeLayer = null;
    if (userMarker) map.removeLayer(userMarker); userMarker = null;
    
    startPoint = null;
    endPoint = null;
    routeSteps = [];
    currentStepIndex = 0;
    routeGeometry = null;
    stopTracking();
    
    // 입력 필드 초기화
    document.getElementById('startAddress').value = '';
    document.getElementById('endAddress').value = '';
    
    // 턴-바이-턴 UI 숨기기
    hideTurnInstruction();
    
    // 지도 초기 위치로 이동
    map.setView(initialCoords, initialZoom);
    
    console.log("맵 및 추적 초기화 완료.");
}


// C. OSRM API 경로 요청 함수 (steps 포함)
async function getRoute() {
    if (!startPoint || !endPoint) {
        alert("출발지와 목적지를 모두 선택해주세요.");
        return;
    }
    const OSRM_URL = "https://router.project-osrm.org";
    const profile = "driving";
    // OSRM은 lon,lat;lon,lat 순서를 선호합니다.
    const coordsStr = `${startPoint.join(',')};${endPoint.join(',')}`;
    // steps=true 추가하여 턴-바이-턴 데이터 받기
    const apiUrl = `${OSRM_URL}/route/v1/${profile}/${coordsStr}?geometries=geojson&overview=full&steps=true`;
    
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            
            // 기존 경로 레이어 제거
            if (routeLayer) {
                map.removeLayer(routeLayer);
            }
            
            routeGeometry = route.geometry; // 경로 geometry 저장 (이탈 감지용)
            routeLayer = L.geoJSON(route.geometry, {
                style: {color: "#0078FF", weight: 5, opacity: 0.8}
            }).addTo(map);
            
            // steps 데이터 추출 및 저장
            if (route.legs && route.legs.length > 0 && route.legs[0].steps) {
                routeSteps = route.legs[0].steps;
                currentStepIndex = 0;
                console.log(`경로 steps 수: ${routeSteps.length}`);
            } else {
                routeSteps = [];
                console.warn('OSRM 응답에 steps 데이터가 없습니다.');
            }
            
            map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });

            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMin = (route.duration / 60).toFixed(0);
            L.popup().setLatLng(map.getCenter())
              .setContent(`🚗 거리: ${distanceKm} km, 시간: ${durationMin} 분`)
              .openOn(map);
        } else {
            alert("경로를 찾을 수 없습니다.");
        }
    } catch (error) {
        console.error("OSRM API 오류:", error);
        alert("경로를 가져오는 데 실패했습니다.");
    }
}


// D. 주소를 좌표로 변환하는 함수 (Nominatim Geocoding API 사용)
async function geocodeAddress(address) {
    if (!address || address.trim() === '') {
        throw new Error('주소를 입력해주세요.');
    }

    // 한국 주소 검색을 위해 "서울" 자동 추가 (주소에 포함되어 있지 않은 경우)
    const searchQuery = address.includes('서울') || address.includes('한국') || address.includes('시') || address.includes('구')
        ? address 
        : `서울 ${address}`;
    
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'NavigationApp/1.0' // Nominatim은 User-Agent 필수
            }
        });
        
        if (!response.ok) {
            throw new Error(`Geocoding API 오류: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error('주소를 찾을 수 없습니다. 다른 주소를 입력해주세요.');
        }
        
        const result = data[0];
        return {
            lat: parseFloat(result.lat),
            lon: parseFloat(result.lon),
            displayName: result.display_name
        };
    } catch (error) {
        console.error('Geocoding 오류:', error);
        throw error;
    }
}

// 현재 위치 가져오기 (GPS)
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('이 브라우저는 Geolocation API를 지원하지 않습니다.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    displayName: '현재 위치'
                });
            },
            (error) => {
                let errorMessage = '위치 정보를 가져올 수 없습니다.';
                
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = '위치 정보를 사용할 수 없습니다. GPS가 켜져있는지 확인해주세요.';
                        break;
                    case error.TIMEOUT:
                        errorMessage = '위치 정보 요청 시간이 초과되었습니다. 다시 시도해주세요.';
                        break;
                    default:
                        errorMessage = `위치 정보 오류: ${error.message}`;
                        break;
                }
                
                console.error('Geolocation 오류:', error);
                reject(new Error(errorMessage));
            },
            { 
                enableHighAccuracy: true, 
                timeout: 15000,  // 타임아웃을 15초로 증가
                maximumAge: 60000  // 1분 이내의 캐시된 위치 사용 가능
            }
        );
    });
}

// 출발지 검색
async function searchStart() {
    const address = document.getElementById('startAddress').value.trim();
    
    try {
        let result;
        
        // 주소가 비어있으면 현재 위치 사용
        if (!address) {
            const useLocation = confirm('출발지가 비어있습니다.\n현재 위치를 사용하시겠습니까?\n\n(위치 권한이 필요합니다)');
            if (!useLocation) {
                alert('출발지 주소를 입력해주세요.');
                return;
            }
            
            try {
                result = await getCurrentLocation();
            } catch (error) {
                alert(`현재 위치를 가져올 수 없습니다.\n\n${error.message}\n\n주소를 직접 입력해주세요.`);
                return;
            }
        } else {
            result = await geocodeAddress(address);
        }
        
        const latlng = [result.lat, result.lon];
        
        // 기존 출발지 마커 제거
        if (startMarker) {
            map.removeLayer(startMarker);
        }
        
        startPoint = [result.lon, result.lat]; // OSRM은 [lon, lat] 순서
        startMarker = L.marker(latlng, {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            })
        }).addTo(map)
            .bindPopup(`<b>출발지</b><br>${result.displayName}`).openPopup();
        
        // 지도 중심 이동
        map.setView(latlng, 15);
        
        console.log(`출발지 설정: ${result.displayName} (${startPoint})`);
        alert(`출발지가 설정되었습니다: ${result.displayName}`);
    } catch (error) {
        alert(`오류: ${error.message}`);
    }
}

// 목적지 검색
async function searchEnd() {
    const address = document.getElementById('endAddress').value.trim();
    
    if (!address) {
        alert('목적지 주소를 입력해주세요.');
        return;
    }
    
    try {
        const result = await geocodeAddress(address);
        const latlng = [result.lat, result.lon];
        
        // 기존 목적지 마커 제거
        if (endMarker) {
            map.removeLayer(endMarker);
        }
        
        endPoint = [result.lon, result.lat]; // OSRM은 [lon, lat] 순서
        endMarker = L.marker(latlng, {
            icon: L.icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            })
        }).addTo(map)
            .bindPopup(`<b>목적지</b><br>${result.displayName}`).openPopup();
        
        // 지도 중심 이동
        map.setView(latlng, 15);
        
        console.log(`목적지 설정: ${result.displayName} (${endPoint})`);
        alert(`목적지가 설정되었습니다: ${result.displayName}`);
    } catch (error) {
        alert(error.message);
    }
}

// 경로 찾기 (출발지가 없으면 현재 위치 사용)
async function findRoute() {
    // 출발지가 설정되지 않았으면 현재 위치로 설정
    if (!startPoint) {
        try {
            // 사용자에게 위치 권한 요청 안내
            const useLocation = confirm('출발지가 설정되지 않았습니다.\n현재 위치를 사용하시겠습니까?\n\n(위치 권한이 필요합니다)');
            if (!useLocation) {
                alert('출발지를 먼저 검색해주세요.');
                return;
            }
            
            // 위치 가져오기 시도
            const currentLocation = await getCurrentLocation();
            const latlng = [currentLocation.lat, currentLocation.lon];
            
            if (startMarker) {
                map.removeLayer(startMarker);
            }
            
            startPoint = [currentLocation.lon, currentLocation.lat];
            startMarker = L.marker(latlng, {
                icon: L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                })
            }).addTo(map)
                .bindPopup(`<b>출발지</b><br>${currentLocation.displayName}`).openPopup();
            
            // 지도 중심 이동
            map.setView(latlng, 15);
            
            alert(`출발지가 현재 위치로 설정되었습니다.`);
        } catch (error) {
            alert(`출발지를 설정할 수 없습니다.\n\n${error.message}\n\n대신 출발지 주소를 직접 입력해주세요.`);
            // 출발지 입력 필드에 포커스
            document.getElementById('startAddress').focus();
            return;
        }
    }
    
    // 목적지 확인
    if (!endPoint) {
        alert('목적지를 먼저 검색해주세요.');
        document.getElementById('endAddress').focus();
        return;
    }
    
    // 경로 요청
    await getRoute();
}

// Enter 키로 검색 가능하도록
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('startAddress').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchStart();
        }
    });
    
    document.getElementById('endAddress').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchEnd();
        }
    });
});


// E. 음성 안내 (TTS) 함수
function speak(text) {
    if ('speechSynthesis' in window) {
        // 이전 음성 중지
        window.speechSynthesis.cancel();
        
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = 'ko-KR';
        msg.rate = 1.0;
        msg.pitch = 1.0;
        window.speechSynthesis.speak(msg);
    } else {
        console.warn('TTS를 지원하지 않는 브라우저입니다.');
    }
}

// F. 거리 계산 함수 (Haversine 공식)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반지름 (미터)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // 미터 단위
}

// G. Bearing(방위각) 계산 함수
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // 0-360도 범위로 정규화
}

// H. 화살표 마커 생성 함수
function createArrowMarker(latlng, bearing) {
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'arrow-marker',
            html: `<div id="arrow-direction" style="transform: rotate(${bearing}deg); transition: transform 0.5s ease; font-size: 30px; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">➤</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        }),
        zIndexOffset: 1000,
        draggable: false  // 마커 드래그 방지
    });
    
    // 마커에 popup 추가 (디버깅용)
    marker.bindPopup(`현재 내 위치<br>방향: ${bearing.toFixed(1)}도`);
    
    return marker;
}

// H-1. 마커 회전 업데이트 함수 (별도 함수로 분리, 실시간 최적화)
function updateMarkerRotation(bearing) {
    if (!userMarker) {
        return; // 로그 제거로 성능 향상
    }
    
    const iconElement = userMarker._icon;
    if (!iconElement) {
        return;
    }
    
    // 방법 1: ID로 찾기
    let arrowDiv = iconElement.querySelector('#arrow-direction');
    
    // 방법 2: ID가 없으면 div로 찾기
    if (!arrowDiv) {
        arrowDiv = iconElement.querySelector('div');
    }
    
    if (arrowDiv) {
        // 부드러운 회전을 위한 transition (짧게 조정)
        arrowDiv.style.transition = 'transform 0.2s ease-out';
        arrowDiv.style.transform = `rotate(${bearing}deg)`;
        // 로그 제거로 성능 향상 (필요시 주석 해제)
        // console.log(`🔄 회전: ${bearing.toFixed(1)}도`);
    }
}

// I. 점과 선분 사이의 최단 거리 계산 (경로 이탈 감지용)
function pointToLineDistance(point, lineStart, lineEnd) {
    const A = point[0] - lineStart[0];
    const B = point[1] - lineStart[1];
    const C = lineEnd[0] - lineStart[0];
    const D = lineEnd[1] - lineStart[1];
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
        param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
        xx = lineStart[0];
        yy = lineStart[1];
    } else if (param > 1) {
        xx = lineEnd[0];
        yy = lineEnd[1];
    } else {
        xx = lineStart[0] + param * C;
        yy = lineStart[1] + param * D;
    }
    
    const dx = point[0] - xx;
    const dy = point[1] - yy;
    
    // Haversine으로 실제 거리 계산
    return calculateDistance(point[1], point[0], yy, xx);
}

// J. 경로 이탈 감지 및 재탐색
function checkRouteDeviation(currentLat, currentLon) {
    if (!routeGeometry || !routeGeometry.coordinates || routeGeometry.coordinates.length < 2) {
        return false;
    }
    
    let minDistance = Infinity;
    
    // 경로의 모든 선분에 대해 최단 거리 계산
    for (let i = 0; i < routeGeometry.coordinates.length - 1; i++) {
        const start = routeGeometry.coordinates[i];
        const end = routeGeometry.coordinates[i + 1];
        const distance = pointToLineDistance(
            [currentLon, currentLat],
            [start[0], start[1]],
            [end[0], end[1]]
        );
        
        if (distance < minDistance) {
            minDistance = distance;
        }
    }
    
    // 30m 이상 이탈 시 재탐색
    if (minDistance > 30) {
        console.log(`경로 이탈 감지: ${minDistance.toFixed(1)}m`);
        reroute(currentLat, currentLon);
        return true;
    }
    
    return false;
}

// K. 재탐색 함수
async function reroute(currentLat, currentLon) {
    if (!endPoint) return;
    
    console.log('경로 재탐색 시작...');
    speak('경로를 재탐색합니다');
    
    // 현재 위치를 새로운 출발지로 설정
    startPoint = [currentLon, currentLat];
    
    // 기존 경로 제거
    if (routeLayer) {
        map.removeLayer(routeLayer);
    }
    
    // 새 경로 요청
    await getRoute();
    
    // 내비게이션 모드가 켜져있으면 계속 추적
    if (isNavigating) {
        startRealTimeTracking();
    }
}

// L. 턴-바이-턴 안내 체크 및 표시
function checkTurnInstruction(currentLat, currentLon) {
    if (routeSteps.length === 0) {
        console.warn("⚠️ routeSteps가 비어있습니다.");
        hideTurnInstruction();
        return;
    }
    
    if (currentStepIndex >= routeSteps.length) {
        // 모든 안내 완료
        hideTurnInstruction();
        speak('목적지에 도착했습니다');
        return;
    }
    
    const currentStep = routeSteps[currentStepIndex];
    
    // Step 데이터 확인
    if (!currentStep) {
        console.warn(`⚠️ Step ${currentStepIndex}이 없습니다.`);
        currentStepIndex++;
        return;
    }
    
    // 현재 step의 maneuver 위치 찾기 (턴 포인트)
    let turnPointLat = null;
    let turnPointLon = null;
    
    // 방법 1: maneuver.location 사용 (OSRM v5+)
    if (currentStep.maneuver && currentStep.maneuver.location) {
        turnPointLon = currentStep.maneuver.location[0];
        turnPointLat = currentStep.maneuver.location[1];
    }
    // 방법 2: geometry의 마지막 좌표 사용 (턴 포인트는 보통 step의 끝)
    else if (currentStep.geometry && currentStep.geometry.coordinates && currentStep.geometry.coordinates.length > 0) {
        const lastCoord = currentStep.geometry.coordinates[currentStep.geometry.coordinates.length - 1];
        turnPointLon = lastCoord[0];
        turnPointLat = lastCoord[1];
    }
    // 방법 3: geometry의 첫 번째 좌표 사용 (폴백)
    else if (currentStep.geometry && currentStep.geometry.coordinates && currentStep.geometry.coordinates.length > 0) {
        const firstCoord = currentStep.geometry.coordinates[0];
        turnPointLon = firstCoord[0];
        turnPointLat = firstCoord[1];
    }
    
    if (turnPointLat === null || turnPointLon === null) {
        console.warn(`⚠️ Step ${currentStepIndex}의 좌표를 찾을 수 없습니다.`, currentStep);
        currentStepIndex++;
        return;
    }
    
    // 현재 위치와 턴 포인트 사이의 거리 계산
    const distanceToTurn = calculateDistance(currentLat, currentLon, turnPointLat, turnPointLon);
    
    // 안내 메시지 추출
    let instruction = '진행하세요';
    if (currentStep.maneuver) {
        // OSRM의 instruction이 있으면 사용
        if (currentStep.maneuver.instruction) {
            instruction = currentStep.maneuver.instruction;
        } else if (currentStep.maneuver.type) {
            // type으로부터 안내 생성
            const maneuverType = currentStep.maneuver.type;
            const modifier = currentStep.maneuver.modifier || '';
            
            if (maneuverType === 'turn') {
                if (modifier === 'left') instruction = '좌회전';
                else if (modifier === 'right') instruction = '우회전';
                else if (modifier === 'sharp left') instruction = '급좌회전';
                else if (modifier === 'sharp right') instruction = '급우회전';
                else if (modifier === 'slight left') instruction = '약간 좌회전';
                else if (modifier === 'slight right') instruction = '약간 우회전';
                else instruction = '회전';
            } else if (maneuverType === 'continue') {
                instruction = '직진';
            } else if (maneuverType === 'arrive') {
                instruction = '도착';
            } else if (maneuverType === 'depart') {
                instruction = '출발';
            } else {
                instruction = maneuverType;
            }
        }
    }
    
    // step의 거리 정보
    const stepDistance = currentStep.distance || 0;
    
    console.log(`📍 Step ${currentStepIndex}/${routeSteps.length}: ${instruction}, 거리: ${distanceToTurn.toFixed(0)}m, step 거리: ${stepDistance.toFixed(0)}m`);
    
    // 100m 이내일 때 안내 표시 (50m에서 100m로 증가)
    if (distanceToTurn < 100) {
        const distanceText = stepDistance > 0 
            ? `${stepDistance.toFixed(0)}m` 
            : `${distanceToTurn.toFixed(0)}m`;
        
        showTurnInstruction(instruction, distanceText);
        
        // 음성 안내는 한 번만 (중복 방지)
        if (distanceToTurn < 50 && !currentStep.announced) {
            speak(instruction);
            currentStep.announced = true; // 중복 방지 플래그
        }
        
        // 20m 이내에 도달하면 다음 step으로 이동
        if (distanceToTurn < 20) {
            currentStepIndex++;
            console.log(`✅ Step ${currentStepIndex - 1} 완료, 다음 step으로 이동`);
        }
    } else {
        // 거리가 멀면 다음 턴까지의 거리 표시
        const distanceText = distanceToTurn > 1000 
            ? `${(distanceToTurn / 1000).toFixed(1)}km` 
            : `${distanceToTurn.toFixed(0)}m`;
        showTurnInstruction('직진', distanceText);
    }
}

// M. 턴-바이-턴 UI 표시
function showTurnInstruction(instruction, distance) {
    const instructionEl = document.getElementById('turnInstruction');
    const distanceEl = document.getElementById('turnDistance');
    const textEl = document.getElementById('turnText');
    
    distanceEl.textContent = distance || '';
    textEl.textContent = instruction;
    instructionEl.classList.add('active');
}

function hideTurnInstruction() {
    const instructionEl = document.getElementById('turnInstruction');
    instructionEl.classList.remove('active');
}

// N. GPS 기반 실시간 위치 추적 로직 (내비게이션 모드)
function startNavigationMode() {
    if (!routeLayer || routeSteps.length === 0) {
        alert('먼저 경로를 찾아주세요.');
        return;
    }
    
    // 기존 추적 중지 후 재시작
    stopTracking();
    
    isNavigating = true;
    currentStepIndex = 0; // step 인덱스 초기화
    previousPosition = null; // 이전 위치 초기화
    
    // 기존 사용자 마커 제거 (새로 시작)
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    
    console.log("🧭 내비게이션 모드 시작");
    startRealTimeTracking();
}

function startRealTimeTracking() {
    if (!navigator.geolocation) {
        alert("이 브라우저는 Geolocation API를 지원하지 않습니다.");
        return;
    }

    // 이미 추적 중이라면 중복 실행 방지
    if (watchId !== null) {
        alert("이미 위치 추적 중입니다.");
        return;
    }
    
    // GPS 추적 옵션 설정 (실시간 업데이트 최적화)
    const options = { 
        enableHighAccuracy: true,  // GPS 사용 (더 정확하지만 배터리 소모 큼)
        timeout: 10000,            // 10초 타임아웃 (빠른 응답)
        maximumAge: 0              // 캐시된 위치 사용 안함 (항상 최신 위치, 0 = 즉시)
    };

    console.log("📍 GPS 위치 추적을 시작합니다...");
    console.log("옵션:", options);
    
    // watchPosition: 위치가 변경될 때마다 자동으로 updatePosition 호출
    // getCurrentPosition과 달리 한 번만 호출하는 게 아니라 계속 추적합니다
    watchId = navigator.geolocation.watchPosition(
        updatePosition,  // 위치 업데이트 시 호출되는 콜백
        handleError,     // 오류 발생 시 호출되는 콜백
        options
    );
    
    // 경로 이탈 체크 인터벌 시작 (1초마다)
    if (rerouteCheckInterval) {
        clearInterval(rerouteCheckInterval);
    }
    rerouteCheckInterval = setInterval(() => {
        if (previousPosition) {
            checkRouteDeviation(previousPosition.lat, previousPosition.lon);
        }
    }, 1000);
    
    // 사용자에게 추적 시작 알림
    speak('위치 추적을 시작합니다');
}

// 마커 업데이트를 위한 throttling (성능 최적화)
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 50; // 50ms마다 업데이트 (20fps - 실시간)

function updatePosition(position) {
    const now = Date.now();
    
    // 너무 자주 업데이트되는 것 방지 (성능 최적화)
    if (now - lastUpdateTime < UPDATE_INTERVAL && previousPosition) {
        return; // 스킵
    }
    lastUpdateTime = now;
    
    // GPS 위치 정보 추출
    const lat = position.coords.latitude;   // 위도
    const lon = position.coords.longitude;   // 경도
    const accuracy = position.coords.accuracy; // 정확도 (미터)
    const heading = position.coords.heading;   // 이동 방향 (0-360도, null일 수 있음)
    const speed = position.coords.speed;      // 속도 (m/s, null일 수 있음)
    
    const newLatLng = [lat, lon];
    
    // 콘솔에 위치 정보 로그 (간소화 - 성능 향상)
    if (previousPosition) {
        const distance = calculateDistance(previousPosition.lat, previousPosition.lon, lat, lon);
        if (distance > 0.5) { // 0.5m 이상 이동했을 때만 로그
            console.log(`📍 ${lat.toFixed(6)}, ${lon.toFixed(6)} | 정확도: ${accuracy.toFixed(0)}m | 속도: ${speed ? (speed * 3.6).toFixed(1) : 'N/A'} km/h`);
        }
    } else {
        console.log(`📍 초기 위치: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    }
    
    // 헤딩(방위각) 계산 - 실시간으로 빠르게 계산
    let bearing = 0;
    
    if (heading !== null && !isNaN(heading) && heading >= 0 && heading <= 360) {
        bearing = heading; // GPS가 제공하는 방향 사용 (가장 정확)
    } else if (previousPosition) {
        // 이전 위치와의 각도 계산 (GPS heading이 없을 때)
        bearing = calculateBearing(
            previousPosition.lat, 
            previousPosition.lon, 
            lat, 
            lon
        );
    }
    
    // requestAnimationFrame을 사용하여 부드러운 업데이트 (즉시 반영)
    requestAnimationFrame(() => {
        updateMarkerAndMap(newLatLng, bearing, lat, lon);
    });
    
    // 이전 위치 저장 (다음 업데이트에서 방향 계산용)
    previousPosition = { lat, lon };
}

// 마커와 지도 업데이트 함수 (별도 분리 - 성능 최적화, 실시간 반영)
function updateMarkerAndMap(newLatLng, bearing, lat, lon) {
    // 1. 마커 업데이트 (화살표 마커로 변경) - 즉시 반영
    if (!userMarker) {
        userMarker = createArrowMarker(newLatLng, bearing).addTo(map);
        console.log(`✅ 마커 생성 | 방향: ${bearing.toFixed(1)}도`);
    } else {
        // 마커 위치 즉시 업데이트 (애니메이션 없이 - 실시간)
        userMarker.setLatLng(newLatLng, { animate: false });
        
        // 마커 회전 즉시 업데이트
        updateMarkerRotation(bearing);
        
        // 마커가 지도에 있는지 확인
        if (!map.hasLayer(userMarker)) {
            userMarker.addTo(map);
        }
    }

    // 2. 지도 중심 이동 - 부드럽게 하지만 빠르게 (실시간 느낌)
    if (previousPosition) {
        // 이전 위치가 있으면 부드럽게 이동 (짧은 시간)
        map.panTo(newLatLng, {
            animate: true,
            duration: 0.2  // 0.2초로 단축 (더 빠른 반응, 실시간 느낌)
        });
    } else {
        // 첫 위치는 즉시 이동
        map.setView(newLatLng, 17, { animate: false });
    }
    
    // 3. 턴-바이-턴 안내 체크 (내비게이션 모드일 때만)
    if (isNavigating && routeSteps.length > 0) {
        checkTurnInstruction(lat, lon);
    }
}

function handleError(error) {
    let errorMessage = '';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = '위치 정보를 사용할 수 없습니다. GPS가 켜져있는지 확인해주세요.';
            break;
        case error.TIMEOUT:
            errorMessage = '위치 정보 요청 시간이 초과되었습니다. GPS 신호를 확인해주세요.';
            break;
        default:
            errorMessage = `위치 오류: ${error.message}`;
            break;
    }
    
    console.error(`❌ GPS 오류 (${error.code}): ${errorMessage}`);
    
    // 사용자에게 알림
    if (isNavigating) {
        alert(`위치 추적 오류\n\n${errorMessage}\n\n위치 권한과 GPS를 확인해주세요.`);
    }
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    if (rerouteCheckInterval) {
        clearInterval(rerouteCheckInterval);
        rerouteCheckInterval = null;
    }
    
    isNavigating = false;
    hideTurnInstruction();
    previousPosition = null;
}